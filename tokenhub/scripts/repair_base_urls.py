#!/usr/bin/env python
"""Repair ``token_keys.base_url`` values corrupted by the pre-2026-10-09 URL regex.

Background
----------
``crawler/extract/credentials.py`` used to match URLs with
``https?://[^\\s"'<>()\\[\\]{}]+`` -- a class that only stops at ASCII whitespace
and a few brackets. Forum posts glue the key list onto the domain with full-width
punctuation and no space::

    https://xlai.pro，sk-576a…，sk-19fb…。一个key5并发

so ``base_url`` was stored as that whole prose fragment. Consequences measured on
2026-10-09:

  * 58 ``probe_log`` rows died with ``UnicodeEncodeError: 'latin-1' codec can't
    encode character '\\uff0c'`` -- urllib cannot put a full-width comma in a
    request line -- so those keys could never be probed and sat at ``unknown``;
  * the site rendered the fragment as the "API 地址", which is unusable;
  * 10 of 11 probe-eligible rows were affected.

The regex is fixed (``URL_RE`` now stops at any non-ASCII code point). This script
repairs the rows already in the database: it truncates ``base_url`` at the first
non-ASCII character and strips trailing ASCII sentence punctuation -- exactly the
value the fixed regex would have extracted from the same text.

Identity note
-------------
``token_keys`` is unique on ``(key_hash, base_url)``, so a repaired row is a NEW
identity for the push layer: the next round INSERTs the corrected row and the
site-side prune reconciliation removes the stale corrupt one (it is no longer in
the crawler's ``keep`` list). The script aborts instead of guessing if a repair
would collide with an existing ``(key_hash, base_url)``.

Usage
-----
    python scripts/repair_base_urls.py                  # dry run (default)
    python scripts/repair_base_urls.py --apply          # write
    python scripts/repair_base_urls.py --apply --db path/to/tokenhub.db
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path(__file__).resolve().parent.parent / "crawler" / "data" / "tokenhub.db"

#: Same set ``extract/credentials.py`` strips (``_URL_TRAILING``).
TRAILING = ")]},.;:!>\"'`"


def clean_base_url(raw: str) -> str:
    """Truncate at the first non-ASCII character, then strip ASCII punctuation."""
    text = raw or ""
    cut = len(text)
    for index, character in enumerate(text):
        if ord(character) > 126:
            cut = index
            break
    return text[:cut].rstrip(TRAILING)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=str(DEFAULT_DB), help="tokenhub SQLite path")
    parser.add_argument("--apply", action="store_true",
                        help="write the repairs (default: dry run, prints a plan only)")
    args = parser.parse_args(argv)

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"db not found: {db_path}", file=sys.stderr)
        return 2

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT id, key_hash, base_url, verdict, source_tid
            FROM token_keys
            WHERE base_url != '' AND base_url GLOB '*[^ -~]*'
            ORDER BY id
            """
        ).fetchall()

        if not rows:
            print("nothing to repair: every base_url is already ASCII-only")
            return 0

        plan: list[tuple[str, str]] = []
        conflicts: list[str] = []
        for row in rows:
            fixed = clean_base_url(row["base_url"])
            if not fixed or not fixed.startswith("http"):
                print(f"  SKIP {row['id'][:8]} (nothing usable before the first "
                      f"non-ASCII char): {row['base_url'][:60]!r}")
                continue
            if fixed == row["base_url"]:
                continue
            clash = conn.execute(
                "SELECT id FROM token_keys WHERE key_hash = ? AND base_url = ?",
                (row["key_hash"], fixed),
            ).fetchone()
            if clash:
                conflicts.append(f"{row['id'][:8]} -> {clash['id'][:8]} at {fixed}")
                continue
            plan.append((row["id"], fixed))

        for row_id, fixed in plan:
            row = next(r for r in rows if r["id"] == row_id)
            print(f"  {row_id[:8]} tid={row['source_tid']:<6} verdict={row['verdict']:<8} "
                  f"{row['base_url'][:52]!r} -> {fixed!r}")

        if conflicts:
            print("\nABORT: repaired values would collide with existing rows "
                  "(UNIQUE(key_hash, base_url)):", file=sys.stderr)
            for line in conflicts:
                print(f"  {line}", file=sys.stderr)
            return 1

        if not args.apply:
            print(f"\ndry run: {len(plan)} row(s) would be repaired. "
                  f"Re-run with --apply to write.")
            return 0

        with conn:
            for row_id, fixed in plan:
                conn.execute("UPDATE token_keys SET base_url = ? WHERE id = ?",
                             (fixed, row_id))
        print(f"\napplied: {len(plan)} row(s) repaired")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
