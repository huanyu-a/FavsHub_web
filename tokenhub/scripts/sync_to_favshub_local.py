#!/usr/bin/env python3
"""Local data bridge: crawler DB -> FavsHub local dev DB.

Pours the crawler's published ``token_keys`` rows into the FavsHub dev SQLite
database so the hao site can render ``/tokens/keys`` locally (``pnpm dev``).
Authoritative spec: ``docs/08-hao站keys页接入设计.md`` §5 (本地数据桥), which
pins every behaviour implemented below:

  #1 open the source strictly read-only (sqlite URI ``mode=ro``);
  #2 bootstrap the three F1 tables + 4 indexes with ``CREATE ... IF NOT
     EXISTS``, one try/except per statement (§4.1; same SQL as
     ``server/database/migrate.ts`` and ``crawler/store/db.py:92-169``);
  #3 read the source with ``WHERE deal_status = 'published'``: dead rows ARE
     copied (the hao page greys them out), hidden rows are skipped and
     counted; ``probe_log`` / ``reveal_log`` tables are created but their
     rows are NOT copied this round;
  #4 upsert every row by ``UNIQUE(key_hash, base_url)``; identity columns
     (id / source_* / first_seen_at / created_at) and ``deal_status`` are
     never overwritten on update, so a row hidden after a takedown notice
     can never be resurrected (``crawler/store/db.py:365-372`` discipline);
  #5 all writes go through one transaction (``with conn``) - any failure
     rolls the whole batch back;
  #6 stdout carries counters only, never key material.

Red lines (docs/07 §8.5, design doc §1.3 #3):
  * no API key, ``key_encrypted`` ciphertext, ``key_hash`` value or cookie is
    ever printed or logged - stdout is counters only, error messages carry
    paths and exception class names only (no row data);
  * ``key_encrypted`` ciphertext is moved verbatim: never decrypted,
    re-encrypted or transformed;
  * the crawler DB is only ever opened read-only.

C-class guide rows (``source = 'reply_visible_guide'``) are mapped per design
doc §4.1 勘误: they carry the credential-free sentinel ``key_hash`` computed
on the crawler side (``db.py:182-185``) and no credential columns - the guard
in :func:`normalize_record` re-asserts that (mirrors the F4 server-side rule
in design doc §4.3) and is a no-op for well-formed crawler data.

Standard library only. Idempotent: safe to re-run.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Optional, Sequence

#: Crawler DB - always opened read-only (red line, design doc §5.2 #1).
DEFAULT_SOURCE_DB = r"D:\project\wwwroot\tokenhub\crawler\data\tokenhub.db"
#: FavsHub dev DB pinned by design doc §5.1 (``nuxt.config.ts`` ``dbPath``
#: resolved against the favshub-nuxt repo root); ``--db`` overrides it.
DEFAULT_TARGET_DB = r"D:\project\wwwroot\FavsHub_web\favshub-nuxt\data\favshub.db"

# ---------------------------------------------------------------------------
# Schema - verbatim from design doc §4.1 (= docs/07 §8.4 =
# crawler/store/db.py:92-138). Same-source triplication: change one, change
# all three. probe_log/reveal_log are created here but their rows are never
# copied (design doc §5.2 #3).
# ---------------------------------------------------------------------------
SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS token_keys (
      id TEXT PRIMARY KEY,
      source_id TEXT DEFAULT 'linux_sb',
      source_tid INTEGER,
      source_url TEXT DEFAULT '',
      source_title TEXT DEFAULT '',
      source_author TEXT DEFAULT '',
      key_masked TEXT DEFAULT '',
      key_hash TEXT DEFAULT '',
      key_encrypted TEXT,
      base_url TEXT DEFAULT '',
      provider TEXT DEFAULT '',
      models TEXT DEFAULT '[]',
      source TEXT DEFAULT 'post',
      confidence TEXT DEFAULT 'low',
      verdict TEXT DEFAULT 'unknown',
      consecutive_failures INTEGER DEFAULT 0,
      last_probe_at INTEGER,
      first_seen_at INTEGER,
      deal_status TEXT DEFAULT 'published',
      note TEXT DEFAULT '',
      created_at INTEGER, updated_at INTEGER,
      UNIQUE(key_hash, base_url)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS probe_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credential_id TEXT NOT NULL,
      base_url TEXT NOT NULL,
      probe_kind TEXT NOT NULL,
      http_status INTEGER,
      error_code TEXT DEFAULT '',
      error_message_raw TEXT DEFAULT '',
      attempt_n INTEGER DEFAULT 1,
      verdict TEXT NOT NULL,
      probed_at INTEGER NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS reveal_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credential_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      ip TEXT DEFAULT '',
      revealed_at INTEGER NOT NULL
    )
    """,
)

#: Same 4 indexes as the crawler (db.py:164-167) and migrate.ts (design doc §4.1).
#: reveal_log gets no index yet (F5 adds one when it lands).
INDEX_STATEMENTS = (
    "CREATE INDEX IF NOT EXISTS idx_token_keys_verdict ON token_keys(verdict)",
    "CREATE INDEX IF NOT EXISTS idx_token_keys_status ON token_keys(deal_status)",
    "CREATE INDEX IF NOT EXISTS idx_probe_log_probed_at ON probe_log(probed_at)",
    "CREATE INDEX IF NOT EXISTS idx_probe_log_credential ON probe_log(credential_id)",
)

#: All token_keys columns in DDL order - the explicit INSERT list.
TOKEN_KEYS_COLUMNS = (
    "id", "source_id", "source_tid", "source_url", "source_title",
    "source_author", "key_masked", "key_hash", "key_encrypted", "base_url",
    "provider", "models", "source", "confidence", "verdict",
    "consecutive_failures", "last_probe_at", "first_seen_at", "deal_status",
    "note", "created_at", "updated_at",
)

INSERT_TOKEN_KEY_SQL = """
INSERT INTO token_keys (
  id, source_id, source_tid, source_url, source_title, source_author,
  key_masked, key_hash, key_encrypted, base_url, provider, models,
  source, confidence, verdict, consecutive_failures, last_probe_at,
  first_seen_at, deal_status, note, created_at, updated_at
) VALUES (
  :id, :source_id, :source_tid, :source_url, :source_title, :source_author,
  :key_masked, :key_hash, :key_encrypted, :base_url, :provider, :models,
  :source, :confidence, :verdict, :consecutive_failures, :last_probe_at,
  :first_seen_at, :deal_status, :note, :created_at, :updated_at
)
"""

# Mutable columns only (design doc §5.2 #4): identity (id / key_hash /
# base_url / source_* / first_seen_at / created_at) and deal_status are never
# touched, so hidden rows are not resurrected and the "收录时间" stays true.
# COALESCE keeps ciphertext already present when the source passes none
# (--no-encrypted always passes NULL).
UPDATE_TOKEN_KEY_SQL = """
UPDATE token_keys SET
  key_masked = :key_masked,
  key_encrypted = COALESCE(:key_encrypted, key_encrypted),
  provider = :provider,
  models = :models,
  source = :source,
  confidence = :confidence,
  note = :note,
  verdict = :verdict,
  consecutive_failures = :consecutive_failures,
  last_probe_at = :last_probe_at,
  updated_at = :updated_at
WHERE id = :row_id
"""


def now_ts() -> int:
    """Whole unix seconds - every timestamp column uses this unit."""
    return int(time.time())


def open_source_readonly(path: str) -> sqlite3.Connection:
    """Open the crawler DB via a ``mode=ro`` URI - it can never be written."""
    uri = Path(path).resolve().as_uri() + "?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def open_target(path: str, dry_run: bool) -> tuple[sqlite3.Connection, str]:
    """Open the target DB; return ``(conn, mode)`` with mode in rw/ro/memory.

    ``--dry-run`` never writes the target file (design doc §5.2 #6): an
    existing file is attached read-only, a missing file is simulated with an
    in-memory DB. A real run creates the file and its parent directory.
    """
    target = Path(path)
    if dry_run:
        if target.exists():
            uri = target.resolve().as_uri() + "?mode=ro"
            conn = sqlite3.connect(uri, uri=True, timeout=5.0)
            conn.row_factory = sqlite3.Row
            return conn, "ro"
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        return conn, "memory"
    os.makedirs(target.parent, exist_ok=True)
    conn = sqlite3.connect(str(target), timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn, "rw"


def bootstrap_schema(conn: sqlite3.Connection) -> None:
    """Create the three F1 tables + 4 indexes (idempotent, design doc §5.2 #2).

    One try/except per statement, mirroring ``createTokenKeysSchema`` in
    migrate.ts (§4.1): a failure is reported and never raised - if the
    critical ``token_keys`` table is missing, the first upsert fails loudly
    with a clear error instead. No row data exists at bootstrap time, so the
    exception text cannot carry secrets.
    """
    for stmt in SCHEMA_STATEMENTS + INDEX_STATEMENTS:
        try:
            conn.execute(stmt)
        except sqlite3.Error as exc:
            print(f"[bridge] WARN schema statement failed: {exc}", file=sys.stderr)


def read_source_rows(conn: sqlite3.Connection) -> tuple[list, int]:
    """Published source rows (dead included - the page greys them, §5.2 #3)
    plus the number of hidden rows skipped at the source."""
    rows = conn.execute(
        "SELECT * FROM token_keys WHERE deal_status = 'published'"
    ).fetchall()
    hidden = conn.execute(
        "SELECT COUNT(*) FROM token_keys WHERE deal_status = 'hidden'"
    ).fetchone()[0]
    return rows, int(hidden)


def normalize_record(row: sqlite3.Row, ts: int, no_encrypted: bool) -> dict:
    """Map one source row onto the target row to write (design doc §5.2 #4).

    Every column is copied by name (C rows already carry the sentinel hash
    and empty credential columns - copied verbatim, never re-derived, so both
    DBs stay byte-identical on the join key). The only rewrites:

    * the C-class guard re-asserts the F4 server-side rule (design doc §4.3):
      guide rows must not carry key_masked / key_encrypted / base_url - a
      no-op for well-formed crawler rows, a hard stop for malformed ones;
    * ``--no-encrypted`` writes NULL ciphertext (the UPDATE's COALESCE keeps
      any ciphertext already stored in the target);
    * ``deal_status`` is pinned to 'published' for the INSERT path only (the
      UPDATE statement never references it);
    * ``updated_at`` is refreshed to now on every sync pass.
    """
    rec = {name: row[name] for name in TOKEN_KEYS_COLUMNS}
    if rec["source"] == "reply_visible_guide":
        rec["key_masked"] = ""
        rec["key_encrypted"] = None
        rec["base_url"] = ""
    if no_encrypted:
        rec["key_encrypted"] = None
    rec["deal_status"] = "published"
    rec["updated_at"] = ts
    return rec


def sync_rows(rows: list, conn: sqlite3.Connection, writable: bool,
              table_present: bool, no_encrypted: bool,
              ts: int) -> tuple[int, int]:
    """Upsert every published source row; return ``(inserted, updated)``.

    ``--dry-run`` executes nothing (``writable=False``): rows are only
    compared against the target, so the counts are exactly what a real run
    would produce. A real run wraps every write in ONE transaction - any
    failure rolls the whole batch back (design doc §5.2 #5).
    """
    existing: dict = {}
    if table_present:
        existing = {
            (r["key_hash"], r["base_url"]): r["id"]
            for r in conn.execute("SELECT id, key_hash, base_url FROM token_keys")
        }
    inserted = updated = 0
    with conn:
        for row in rows:
            rec = normalize_record(row, ts, no_encrypted)
            identity = (rec["key_hash"], rec["base_url"])
            row_id = existing.get(identity)
            if row_id is None:
                if writable:
                    conn.execute(INSERT_TOKEN_KEY_SQL, rec)
                existing[identity] = rec["id"]  # in-batch duplicates become updates
                inserted += 1
            else:
                if writable:
                    conn.execute(UPDATE_TOKEN_KEY_SQL, {**rec, "row_id": row_id})
                updated += 1
    return inserted, updated


def count_target_rows(conn: sqlite3.Connection) -> int:
    return int(conn.execute("SELECT COUNT(*) FROM token_keys").fetchone()[0])


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Local data bridge: crawler tokenhub.db -> FavsHub dev favshub.db "
                    "(design doc 08 §5). Counters-only stdout; idempotent.")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="count only, never write the target DB (a missing target is "
             "simulated in memory, an existing one is attached read-only)")
    parser.add_argument(
        "--source", default=DEFAULT_SOURCE_DB,
        help="crawler SQLite DB to read (always opened read-only)")
    parser.add_argument(
        "--db", default=DEFAULT_TARGET_DB,
        help="FavsHub dev SQLite DB to write (created if missing)")
    parser.add_argument(
        "--no-encrypted", action="store_true",
        help="do not copy key_encrypted ciphertext (ciphertext already in "
             "the target is preserved by the UPDATE's COALESCE)")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)
    ts = now_ts()
    source_conn: Optional[sqlite3.Connection] = None
    target_conn: Optional[sqlite3.Connection] = None
    try:
        try:
            source_conn = open_source_readonly(args.source)
        except (sqlite3.Error, OSError, ValueError) as exc:
            print(f"[bridge] ERROR cannot open source read-only: {args.source} "
                  f"({type(exc).__name__}: {exc})", file=sys.stderr)
            return 1
        try:
            target_conn, mode = open_target(args.db, args.dry_run)
        except (sqlite3.Error, OSError, ValueError) as exc:
            print(f"[bridge] ERROR cannot open target: {args.db} "
                  f"({type(exc).__name__}: {exc})", file=sys.stderr)
            return 1

        # #2 bootstrap (skipped implicitly: a read-only dry-run never writes;
        # an in-memory dry-run target gets the schema so counts are realistic).
        if mode != "ro":
            bootstrap_schema(target_conn)

        table_present = True
        if mode == "ro":
            table_present = target_conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='token_keys'"
            ).fetchone() is not None
            if not table_present:
                print("[bridge] note: target has no token_keys table; "
                      "--dry-run counts assume an empty target", file=sys.stderr)

        try:
            source_rows, hidden_skipped = read_source_rows(source_conn)
        except sqlite3.Error as exc:
            print(f"[bridge] ERROR cannot read source: {args.source} "
                  f"({type(exc).__name__}: {exc})", file=sys.stderr)
            return 1

        try:
            inserted, updated = sync_rows(
                source_rows, target_conn, writable=(mode == "rw"),
                table_present=table_present, no_encrypted=args.no_encrypted,
                ts=ts)
            # Real run: post-commit reality. Dry run: projection only
            # (existing rows + would-be inserts; nothing was executed).
            if mode == "rw":
                total = count_target_rows(target_conn)
            else:
                pre = count_target_rows(target_conn) if table_present else 0
                total = pre + inserted
        except sqlite3.Error as exc:
            # sqlite3 messages name tables/columns only, never bound values.
            print(f"[bridge] ERROR sync failed: {type(exc).__name__}: {exc}",
                  file=sys.stderr)
            return 1
        except Exception as exc:  # class name only - str() could embed row data
            print(f"[bridge] ERROR sync failed: {type(exc).__name__}",
                  file=sys.stderr)
            return 1

        # #6 counters only - never any row content.
        print(f"[bridge] source rows(published): {len(source_rows)}")
        print(f"[bridge] inserted: {inserted}  updated: {updated}  "
              f"total_in_target: {total}")
        print(f"[bridge] skipped hidden at source: {hidden_skipped}")
        if args.dry_run:
            print("[bridge] DRY-RUN: nothing was written")
        print("[bridge] OK")
        return 0
    finally:
        if source_conn is not None:
            source_conn.close()
        if target_conn is not None:
            target_conn.close()


if __name__ == "__main__":
    sys.exit(main())
