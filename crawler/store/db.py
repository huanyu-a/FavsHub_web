"""SQLite persistence layer for the P0 crawler (07 8.4 / P0-7 / P0-9).

Owned by the skeleton author; implementers must NOT edit it. Storage is
"dumb": this module never hashes, masks or encrypts — the caller passes the
already-computed ``key_hash`` / ``key_masked`` / ``key_encrypted`` produced by
:mod:`crypto`. That keeps the security red lines (07 8.5) in one place.

All SQL is parameterised (``?`` placeholders only); no string interpolation of
values anywhere.

Tables (07 8.4, verbatim ``token_keys`` / ``probe_log`` / ``reveal_log``) plus
two P0-only tables the plan references but does not spell out:
  * ``crawl_state``  — the per-source ``tid`` watermark cursor (07 4 step #1).
  * ``manual_queue`` — the P0 manual-review queue (07 P0-9: low-confidence /
    suspected-valuable E / unknown stalled 5 rounds / D-class benefit info).

C-class guide rows (07 D2: "不提取不存储 key")
------------------------------------------------
The authoritative DDL pins ``UNIQUE(key_hash, base_url)``. A literal empty
``key_hash`` + empty ``base_url`` for every C-class guide row would make that
constraint collapse all guide rows into one and block the second insert. Since
the DDL must not be edited here, ``guide_key_hash()`` derives a stable,
credential-free sentinel hash from ``(source_id, tid)`` and keeps
``key_masked`` / ``key_encrypted`` / ``base_url`` empty. No plaintext credential
is ever stored for C rows, so 07 8.4 / 8.5 / D2 all still hold. See
ARCHITECTURE.md "Known contract tension".
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Single source of truth for the thresholds (07 8.3 / 5.1) lives in interfaces.py;
# import rather than re-declare so a value can never drift between layers.
from interfaces import (
    DEAD_CONSECUTIVE_INVALID,
    DEAD_REPROBE_INTERVAL_S,
    PROBE_LOG_RETENTION_DAYS,
)

#: ``dead`` rows are re-probed at most once per this many seconds (07 8.3 / D3).
DEAD_REPROBE_INTERVAL_SECONDS = DEAD_REPROBE_INTERVAL_S
#: ``probe_log`` retention, days (07 5.1 P0-7: "保留 90 天", (06 修订)).
#: re-exported from :data:`interfaces.PROBE_LOG_RETENTION_DAYS`.
__all__ = [
    "PROBE_LOG_RETENTION_DAYS",
    "DEAD_REPROBE_INTERVAL_SECONDS",
    "SCHEMA_STATEMENTS",
    "now_ts",
    "new_id",
    "guide_key_hash",
    "connect",
    "connect_in_memory",
    "init_db",
    "migrate_schema",
    "get_watermark",
    "get_crawl_state",
    "set_watermark",
    "models_to_json",
    "upsert_token_key",
    "set_deal_status",
    "get_token_key",
    "count_unknown_streak",
    "count_undecided_streak",
    "update_verdict",
    "select_publishable",
    "select_dead_for_reprobe",
    "select_reprobe_candidates",
    "token_key_stats",
    "insert_probe_log",
    "prune_probe_log",
    "record_reveal",
    "enqueue_manual",
    "list_manual",
    "resolve_manual",
]

_DAY_SECONDS = 24 * 60 * 60


# ---------------------------------------------------------------------------
# Schema (07 8.4) — token_keys / probe_log / reveal_log are copied verbatim.
# ---------------------------------------------------------------------------

SCHEMA_STATEMENTS: Sequence[str] = (
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
      post_time TEXT DEFAULT '',
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
    # -- P0-only tables (not spelled out in 07 8.4; referenced by 07 4 / P0-9) --
    """
    CREATE TABLE IF NOT EXISTS crawl_state (
      source_id TEXT PRIMARY KEY,
      last_tid INTEGER NOT NULL DEFAULT 0,
      last_sitemap_lastmod TEXT DEFAULT '',
      updated_at INTEGER
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS manual_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reason TEXT NOT NULL,
      source_id TEXT DEFAULT '',
      source_tid INTEGER,
      credential_id TEXT DEFAULT '',
      key_hash TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    )
    """,
    # Supporting indexes for the recurring P0 queries.
    "CREATE INDEX IF NOT EXISTS idx_token_keys_verdict ON token_keys(verdict)",
    "CREATE INDEX IF NOT EXISTS idx_token_keys_status ON token_keys(deal_status)",
    "CREATE INDEX IF NOT EXISTS idx_probe_log_probed_at ON probe_log(probed_at)",
    "CREATE INDEX IF NOT EXISTS idx_probe_log_credential ON probe_log(credential_id)",
    "CREATE INDEX IF NOT EXISTS idx_manual_queue_status ON manual_queue(status)",
)


def now_ts() -> int:
    """Current unix time in whole seconds (all timestamps use this)."""
    return int(time.time())


def new_id() -> str:
    """Opaque primary key for ``token_keys.id``."""
    return uuid.uuid4().hex


def guide_key_hash(source_id: str, tid: int) -> str:
    """Credential-free sentinel hash so multiple C-class guide rows can coexist
    under ``UNIQUE(key_hash, base_url)`` without storing any real credential."""
    return hashlib.sha256(f"guide|{source_id}|{int(tid)}".encode("utf-8")).hexdigest()


def connect(db_path: str) -> sqlite3.Connection:
    """Open (creating if needed) the SQLite DB in WAL mode (07 3: FavsHub WAL)."""
    directory = os.path.dirname(os.path.abspath(db_path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def connect_in_memory() -> sqlite3.Connection:
    """Throwaway in-memory DB with the same PRAGMAs (``--dry-run`` / unit tests).

    Test rule honoured: tests never touch ``crawler/data/`` (07 5.1 acceptance
    is per-cycle, but the suite must be self-contained).
    """
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables and indexes (idempotent, safe to run every cycle).

    Also applies :func:`migrate_schema`: ``CREATE TABLE IF NOT EXISTS`` cannot
    add a column to a table that already exists, so a database created by an
    older build would otherwise crash the cycle the first time a newer column
    is written (this exact failure was hit live: a ``crawl_state`` table from
    before the sitemap bookmark made ``set_watermark`` raise
    ``sqlite3.OperationalError: table crawl_state has no column named
    last_sitemap_lastmod``). Schema repair is idempotent infrastructure, not
    crawl data, so it runs in every mode including ``--dry-run``.
    """
    with conn:
        for stmt in SCHEMA_STATEMENTS:
            conn.execute(stmt)
    migrate_schema(conn)


#: Idempotent column migrations for databases created by older builds, applied
#: by :func:`migrate_schema`. Each pair is (probe, alter): the literal probe
#: SELECT succeeds when the column already exists; the literal ALTER adds it
#: when the probe raises. Both strings are fixed code constants — never user
#: input, no interpolation (test_store_db's source scan and the store red line).
MIGRATIONS: Sequence[Tuple[str, str]] = (
    (
        # sitemap fallback bookmark (07 §四 ①), written by set_watermark since
        # the sources owner's P0-2 landed; missing from early crawl_state DDLs.
        "SELECT last_sitemap_lastmod FROM crawl_state LIMIT 0",
        "ALTER TABLE crawl_state ADD COLUMN last_sitemap_lastmod TEXT DEFAULT ''",
    ),
    (
        # original forum post time (raw string, verbatim from the source feed /
        # API), surfaced on the site keys page; missing from pre-2026-10-08 DDLs.
        "SELECT post_time FROM token_keys LIMIT 0",
        "ALTER TABLE token_keys ADD COLUMN post_time TEXT DEFAULT ''",
    ),
)


def migrate_schema(conn: sqlite3.Connection) -> int:
    """Add columns that pre-existing tables are missing; return count applied.

    Idempotent: a second call finds every probe succeeding and applies nothing.
    Must run AFTER :data:`SCHEMA_STATEMENTS` so the tables themselves exist —
    a missing TABLE is created by the DDL, a missing COLUMN is what migrates.
    """
    applied = 0
    for probe, alter in MIGRATIONS:
        try:
            conn.execute(probe)
        except sqlite3.OperationalError:  # column missing on this database
            with conn:
                conn.execute(alter)
            applied += 1
    return applied


# ---------------------------------------------------------------------------
# crawl_state (tid watermark cursor)
# ---------------------------------------------------------------------------


def get_watermark(conn: sqlite3.Connection, source_id: str) -> int:
    """Current ``tid`` cursor for a source; 0 when nothing has run yet."""
    row = conn.execute(
        "SELECT last_tid FROM crawl_state WHERE source_id = ?", (source_id,)
    ).fetchone()
    return int(row["last_tid"]) if row else 0


def get_crawl_state(conn: sqlite3.Connection, source_id: str) -> Optional[sqlite3.Row]:
    """Full ``crawl_state`` row for a source (``last_tid`` + ``last_sitemap_lastmod``).

    Provided so the sources owner can read the sitemap watermark without writing
    SQL into a skeleton-owned file.
    """
    return conn.execute(
        "SELECT * FROM crawl_state WHERE source_id = ?", (source_id,)
    ).fetchone()


def set_watermark(
    conn: sqlite3.Connection,
    source_id: str,
    tid: int,
    ts: Optional[int] = None,
    sitemap_lastmod: Optional[str] = None,
) -> None:
    """Advance the cursor. ``last_tid`` only ever increases (monotonic guard so an
    out-of-order page cannot rewind the watermark); ``sitemap_lastmod`` refreshes
    the fallback bookmark when given (07 §四 ① sitemap fallback)."""
    ts = ts if ts is not None else now_ts()
    with conn:
        conn.execute(
            """
            INSERT INTO crawl_state (source_id, last_tid, last_sitemap_lastmod, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(source_id) DO UPDATE SET
              last_tid = MAX(last_tid, excluded.last_tid),
              last_sitemap_lastmod = COALESCE(excluded.last_sitemap_lastmod,
                                             crawl_state.last_sitemap_lastmod),
              updated_at = excluded.updated_at
            """,
            (source_id, int(tid), sitemap_lastmod, ts),
        )


# ---------------------------------------------------------------------------
# token_keys
# ---------------------------------------------------------------------------


def _default_token_key(**overrides: Any) -> Dict[str, Any]:
    """Full column set with the 07 8.4 defaults; overrides fill in real values."""
    ts = overrides.get("created_at") or now_ts()
    record: Dict[str, Any] = {
        "id": new_id(),
        "source_id": "linux_sb",
        "source_tid": None,
        "source_url": "",
        "source_title": "",
        "source_author": "",
        "key_masked": "",
        "key_hash": "",
        "key_encrypted": None,
        "base_url": "",
        "provider": "",
        "models": "[]",
        "source": "post",
        "confidence": "low",
        "verdict": "unknown",
        "consecutive_failures": 0,
        "last_probe_at": None,
        "first_seen_at": ts,
        "post_time": "",
        "deal_status": "published",
        "note": "",
        "created_at": ts,
        "updated_at": ts,
    }
    record.update(overrides)
    return record


def models_to_json(models: Optional[Sequence[str]]) -> str:
    """Normalise the ``models`` column to a JSON array string (07 default ``'[]'``)."""
    return json.dumps(list(models) if models else [], ensure_ascii=False)


def upsert_token_key(conn: sqlite3.Connection, record: Dict[str, Any]) -> str:
    """Insert or update by ``UNIQUE(key_hash, base_url)`` (07 P0-7 dedupe).

    Returns the row ``id`` (existing id on conflict). Identity columns that are
    the natural key (``id`` / ``key_hash`` / ``base_url`` / ``source_*`` /
    ``first_seen_at`` / ``created_at``) are never overwritten on update; only the
    mutable verdict / enrichment columns refresh each cycle.

    ``key_hash`` + ``base_url`` must be present. For C-class guide rows pass
    ``key_hash=guide_key_hash(source_id, tid)`` and leave the key columns empty.

    Column ownership on update (deliberate, keeps the 07 8.3 / D12 semantics):
      * ``verdict`` / ``consecutive_failures`` / ``last_probe_at`` belong to the
        state machine and are written only by :func:`update_verdict`. Re-writing
        them here would reset the "连续 2 次一致才判 dead" counter every cycle.
      * ``deal_status`` is owned by :func:`set_deal_status`; an upsert must never
        resurrect a row that was hidden after a takedown notice (07 D12).
      * ``first_seen_at`` / ``created_at`` / ``source_*`` are identity history.
    """
    required = ("key_hash", "base_url")
    missing = [k for k in required if k not in record]
    if missing:
        raise ValueError(f"upsert_token_key missing required keys: {missing}")
    rec = _default_token_key(**record)
    ts = rec["updated_at"] or now_ts()

    existing = conn.execute(
        "SELECT id FROM token_keys WHERE key_hash = ? AND base_url = ?",
        (rec["key_hash"], rec["base_url"]),
    ).fetchone()

    with conn:
        if existing is None:
            conn.execute(
                """
                INSERT INTO token_keys (
                  id, source_id, source_tid, source_url, source_title, source_author,
                  key_masked, key_hash, key_encrypted, base_url, provider, models,
                  source, confidence, verdict, consecutive_failures, last_probe_at,
                  first_seen_at, post_time, deal_status, note, created_at, updated_at
                ) VALUES (
                  :id, :source_id, :source_tid, :source_url, :source_title, :source_author,
                  :key_masked, :key_hash, :key_encrypted, :base_url, :provider, :models,
                  :source, :confidence, :verdict, :consecutive_failures, :last_probe_at,
                  :first_seen_at, :post_time, :deal_status, :note, :created_at, :updated_at
                )
                """,
                rec,
            )
            return rec["id"]
        row_id = existing["id"]
        conn.execute(
            """
            UPDATE token_keys SET
              key_masked = :key_masked,
              key_encrypted = COALESCE(:key_encrypted, key_encrypted),
              provider = :provider,
              models = :models,
              source = :source,
              confidence = :confidence,
              note = :note,
              post_time = CASE WHEN :post_time != '' THEN :post_time ELSE post_time END,
              updated_at = :updated_at
            WHERE id = :row_id
            """,
            {**rec, "row_id": row_id, "updated_at": ts},
        )
        return row_id


def set_deal_status(conn: sqlite3.Connection, credential_id: str, deal_status: str) -> None:
    """Notice-and-hide flow (07 D12): flip a row to hidden / back to published."""
    with conn:
        conn.execute(
            "UPDATE token_keys SET deal_status = ?, updated_at = ? WHERE id = ?",
            (deal_status, now_ts(), credential_id),
        )


def get_token_key(conn: sqlite3.Connection, credential_id: str) -> Optional[sqlite3.Row]:
    """Fetch one ``token_keys`` row (used to feed the previous state to the
    probe state machine, which needs the cross-cycle counters, 07 8.3)."""
    return conn.execute(
        "SELECT * FROM token_keys WHERE id = ?", (credential_id,)
    ).fetchone()


def count_unknown_streak(conn: sqlite3.Connection, credential_id: str,
                         limit: int = 64) -> int:
    """How many most-recent ``probe_log`` rows for this credential said ``unknown``.

    The authoritative DDL has no round counter column (07 8.4), so the "unknown
    连续 5 轮未决" input (07 8.3) is derived from the probe audit trail instead.
    Call it BEFORE inserting the current outcome (that is how ``main.run_cycle``
    feeds ``ProbeState.unknown_rounds``): the returned streak is the one that had
    already ended when this cycle started.
    """
    rows = conn.execute(
        """
        SELECT verdict FROM probe_log
        WHERE credential_id = ?
        ORDER BY probed_at DESC, id DESC
        LIMIT ?
        """,
        (credential_id, limit),
    ).fetchall()
    streak = 0
    for row in rows:
        if row["verdict"] != "unknown":
            break
        streak += 1
    return streak


def count_undecided_streak(conn: sqlite3.Connection, credential_id: str,
                           limit: int = 64) -> int:
    """How many most-recent ``probe_log`` rows left this credential undecided.

    Additive integration helper fixing a cross-module seam: ``probe_log`` stores
    the RAW response label, so an "invalid candidate" is recorded as
    ``'invalid'`` while :meth:`probe.verdict.StateMachine.next` folds it into a
    persisted ``unknown`` (a lone candidate is undecided, 07 8.3). Feeding only
    :func:`count_unknown_streak` into ``ProbeState.unknown_rounds`` therefore
    reset the "unknown 连续 5 轮未决" counter every cycle for keys that keep
    answering invalid without ever being confirmed - exactly the rows the probe
    owner says a human should look at. The undecided set is ``unknown``
    (transport / 5xx / undecided rejection) plus ``invalid`` (unconfirmed
    candidate); any decided verdict (valid/quota/limited/dead/restricted/...)
    breaks the streak, mirroring the state machine.

    Call it BEFORE inserting the current outcome, like :func:`count_unknown_streak`.
    """
    rows = conn.execute(
        """
        SELECT verdict FROM probe_log
        WHERE credential_id = ?
        ORDER BY probed_at DESC, id DESC
        LIMIT ?
        """,
        (credential_id, limit),
    ).fetchall()
    streak = 0
    for row in rows:
        if row["verdict"] not in ("unknown", "invalid"):
            break
        streak += 1
    return streak


def update_verdict(
    conn: sqlite3.Connection,
    credential_id: str,
    verdict: str,
    consecutive_failures: int,
    last_probe_at: Optional[int] = None,
) -> None:
    """Write back the state-machine verdict for an existing row (07 8.3 / 8.4)."""
    ts = last_probe_at if last_probe_at is not None else now_ts()
    with conn:
        conn.execute(
            """
            UPDATE token_keys
            SET verdict = ?, consecutive_failures = ?, last_probe_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (verdict, int(consecutive_failures), ts, ts, credential_id),
        )


def select_publishable(conn: sqlite3.Connection) -> List[sqlite3.Row]:
    """Rows eligible for feed / page (07 D3 / 8.5): published and NOT dead.

    ``dead`` is excluded from the feed but retained (greyed) on the page; hidden
    rows are excluded everywhere (D12).
    """
    return conn.execute(
        """
        SELECT * FROM token_keys
        WHERE deal_status = 'published' AND verdict != 'dead'
        ORDER BY first_seen_at DESC
        """
    ).fetchall()


def select_dead_for_reprobe(conn: sqlite3.Connection, ts: Optional[int] = None) -> List[sqlite3.Row]:
    """Dead rows due for the daily recovery re-probe (07 8.3 / D3)."""
    ts = ts if ts is not None else now_ts()
    cutoff = ts - DEAD_REPROBE_INTERVAL_SECONDS
    return conn.execute(
        """
        SELECT * FROM token_keys
        WHERE verdict = 'dead'
          AND (last_probe_at IS NULL OR last_probe_at <= ?)
        ORDER BY last_probe_at ASC
        """,
        (cutoff,),
    ).fetchall()


def select_reprobe_candidates(conn: sqlite3.Connection, ts: Optional[int] = None) -> List[sqlite3.Row]:
    """Every credential row the probe stage must visit this cycle (07 8.3 复探节奏).

    Additive integration helper (the cycle owns the probe schedule, not a single
    caller): non-``dead`` rows ride the 3-hourly cron ("valid/limited 每 3 小时
    随 cron"); ``dead`` rows only after the daily interval ("dead 每天复探 1 次
    可挽回", D3). Rows that cannot be probed are excluded here so the caller
    never has to guess:

      * C-class guide rows carry no credential and ``key_encrypted IS NULL``;
      * a row without ``base_url`` has no endpoint to probe;
      * ``deal_status`` is irrelevant to probing - a hidden row is still probed
        so its verdict stays truthful for the audit trail (D12 only governs
        publishing, which :func:`select_publishable` owns).

    Callers must still de-conflict with the fresh-key loop of the same cycle
    (a row stored + probed earlier in this cycle is not re-probed).
    """
    ts = ts if ts is not None else now_ts()
    cutoff = ts - DEAD_REPROBE_INTERVAL_SECONDS
    return conn.execute(
        """
        SELECT * FROM token_keys
        WHERE key_encrypted IS NOT NULL
          AND IFNULL(base_url, '') != ''
          AND (
            verdict != 'dead'
            OR last_probe_at IS NULL
            OR last_probe_at <= ?
          )
        ORDER BY first_seen_at ASC, id ASC
        """,
        (cutoff,),
    ).fetchall()


def token_key_stats(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Snapshot counts the daily report's 07 5.5 gate section is built from.

    Returns ``{"by_verdict": {...}, "by_source": {...}, "with_two_consecutive_invalids": n}``.
    ``with_two_consecutive_invalids`` is the denominator of the false-positive
    gate question (GATE "dead rows / rows that had 2 consistent invalids", 07 8.3).
    """
    by_verdict = {
        row["verdict"]: int(row["n"])
        for row in conn.execute(
            "SELECT verdict, COUNT(*) AS n FROM token_keys GROUP BY verdict")
    }
    by_source = {
        row["source"]: int(row["n"])
        for row in conn.execute(
            "SELECT source, COUNT(*) AS n FROM token_keys GROUP BY source")
    }
    two_failures = conn.execute(
        "SELECT COUNT(*) AS n FROM token_keys WHERE consecutive_failures >= ?",
        (DEAD_CONSECUTIVE_INVALID,),
    ).fetchone()
    return {
        "by_verdict": by_verdict,
        "by_source": by_source,
        "with_two_consecutive_invalids": int(two_failures["n"]) if two_failures else 0,
    }


# ---------------------------------------------------------------------------
# probe_log
# ---------------------------------------------------------------------------


def insert_probe_log(conn: sqlite3.Connection, outcome: Any) -> int:
    """Insert one :class:`interfaces.ProbeOutcome` (or a mapping) into probe_log.

    ``error_message_raw`` is stored for audit only and must never reach a page
    or the feed (07 8.5).
    """
    if isinstance(outcome, dict):
        g = outcome.get
    else:
        g = lambda k, d=None: getattr(outcome, k, d)  # noqa: E731
    ts = g("probed_at") or now_ts()
    with conn:
        cur = conn.execute(
            """
            INSERT INTO probe_log (
              credential_id, base_url, probe_kind, http_status, error_code,
              error_message_raw, attempt_n, verdict, probed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                g("credential_id"),
                g("base_url", ""),
                g("probe_kind", ""),
                g("http_status"),
                g("error_code", ""),
                g("error_message_raw", ""),
                g("attempt_n", 1),
                g("verdict", "unknown"),
                ts,
            ),
        )
        return int(cur.lastrowid)


def prune_probe_log(conn: sqlite3.Connection, days: int = PROBE_LOG_RETENTION_DAYS,
                    ts: Optional[int] = None) -> int:
    """Delete probe_log rows older than ``days`` (07 5.1 P0-7). Returns count."""
    ts = ts if ts is not None else now_ts()
    cutoff = ts - days * _DAY_SECONDS
    with conn:
        cur = conn.execute("DELETE FROM probe_log WHERE probed_at < ?", (cutoff,))
        return cur.rowcount


#: Reply-visible guide rows expire 24h after they were first collected: the
#: "reply to unlock" windows these posts advertise are inherently short-lived,
#: and the site owner asked for the stale ones to be cleaned automatically
#: (2026-10-08). B-class key rows keep the state-machine lifecycle instead.
GUIDE_ROW_TTL_SECONDS = 24 * 3600


def prune_expired_guide_rows(conn: sqlite3.Connection, ts: Optional[int] = None,
                             ttl_s: int = GUIDE_ROW_TTL_SECONDS) -> int:
    """Delete ``reply_visible_guide`` rows first seen more than ``ttl_s`` ago.

    Uses ``first_seen_at`` (collection time), not the forum post time: a guide
    discovered today from an old thread is still worth showing for its 24h
    window. Returns the number of rows deleted.
    """
    ts = ts if ts is not None else now_ts()
    cutoff = ts - ttl_s
    with conn:
        cur = conn.execute(
            "DELETE FROM token_keys WHERE source = 'reply_visible_guide' AND first_seen_at < ?",
            (cutoff,),
        )
        return cur.rowcount


# ---------------------------------------------------------------------------
# reveal_log (07 8.4 — created now, used from P1 / D2)
# ---------------------------------------------------------------------------


def record_reveal(conn: sqlite3.Connection, credential_id: str, user_id: str,
                  ip: str = "", ts: Optional[int] = None) -> int:
    """Append an audit row each time a full key is revealed (07 F5 / D2)."""
    ts = ts if ts is not None else now_ts()
    with conn:
        cur = conn.execute(
            """
            INSERT INTO reveal_log (credential_id, user_id, ip, revealed_at)
            VALUES (?, ?, ?, ?)
            """,
            (credential_id, user_id, ip, ts),
        )
        return int(cur.lastrowid)


# ---------------------------------------------------------------------------
# manual_queue (07 P0-9)
# ---------------------------------------------------------------------------


def enqueue_manual(conn: sqlite3.Connection, reason: str, source_id: str = "",
                   source_tid: Optional[int] = None, credential_id: str = "",
                   key_hash: str = "", detail: str = "", ts: Optional[int] = None) -> int:
    """Add a manual-review item; dedupe identical still-pending (reason, key_hash, tid)."""
    ts = ts if ts is not None else now_ts()
    existing = conn.execute(
        """
        SELECT id FROM manual_queue
        WHERE status = 'pending' AND reason = ?
          AND IFNULL(source_tid, -1) = IFNULL(?, -1)
          AND key_hash = ?
        """,
        (reason, source_tid, key_hash),
    ).fetchone()
    if existing:
        return int(existing["id"])
    with conn:
        cur = conn.execute(
            """
            INSERT INTO manual_queue
              (reason, source_id, source_tid, credential_id, key_hash, detail, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
            """,
            (reason, source_id, source_tid, credential_id, key_hash, detail, ts),
        )
        return int(cur.lastrowid)


def list_manual(conn: sqlite3.Connection, status: str = "pending") -> List[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM manual_queue WHERE status = ? ORDER BY created_at DESC",
        (status,),
    ).fetchall()


def resolve_manual(conn: sqlite3.Connection, item_id: int, ts: Optional[int] = None) -> None:
    ts = ts if ts is not None else now_ts()
    with conn:
        conn.execute(
            "UPDATE manual_queue SET status = 'resolved', resolved_at = ? WHERE id = ?",
            (ts, item_id),
        )
