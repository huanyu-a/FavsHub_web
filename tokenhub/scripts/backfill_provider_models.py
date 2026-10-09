#!/usr/bin/env python
"""Backfill ``token_keys.provider`` / ``models`` for rows stored before 2026-10-09.

Background
----------
Both columns exist in the schema and are carried end-to-end (crawler upsert ->
snapshot -> ``push_to_favshub.py`` -> site ``/api/token-keys`` -> card chips),
but nothing ever *produced* a value:

  * ``provider`` came only from ``provider_for_key`` (07 §8.2 key-prefix
    heuristic). Every live row is an anonymous ``sk-`` relay key, which matches
    no prefix, so ``provider`` was ``''`` and the card header fell back to the
    post title -- 11 relays all rendering as 「免费token」;
  * ``models`` was never written at all: ``'[]'`` on every row, so the card's
    model-chip row (前 3 + N) could never render.

``crawler/extract/models.py`` and ``crawler/extract/provider.py`` fix this for
**new** rows. These 13 rows will not be re-extracted: the crawler watermark
(``crawl_state.last_tid``) has already passed their topics, so the pipeline
never sees them again. This script applies the same two pure functions to the
stored columns.

What it can and cannot recover
------------------------------
  * ``provider`` - derived from ``base_url``, which is stored. Exact.
  * ``models`` - derived from ``source_title``. The post **body** is not stored
    (only its masked/hashed key and the title survive; 07 §8.5), so a body-only
    mention cannot be recovered here. Titles carry the model for most rows
    ("无限deepseek", "Opus5.5-100刀", "免费的grok4.6", "GLM模型Token大放送");
    the rest stay ``[]`` rather than being guessed at.

Only empty values are filled: a row that already has a provider (a vendor-prefix
guess) or models is never rewritten.

Usage
-----
    python scripts/backfill_provider_models.py            # dry run (default)
    python scripts/backfill_provider_models.py --apply    # write
    python scripts/backfill_provider_models.py --apply --db path/to/tokenhub.db
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / "crawler" / "data" / "tokenhub.db"

#: The crawler package is imported the same way the tests do it: crawler/ is the
#: import root (``from extract.provider import ...``).
sys.path.insert(0, str(ROOT / "crawler"))

from extract.models import find_model_mentions  # noqa: E402
from extract.provider import provider_for_base_url  # noqa: E402


def plan_row(row: sqlite3.Row) -> tuple[str, str]:
    """Return the ``(provider, models_json)`` this row should hold."""
    provider = (row["provider"] or "").strip()
    if not provider:
        provider = provider_for_base_url(row["base_url"] or "")

    try:
        existing = json.loads(row["models"] or "[]")
    except ValueError:
        existing = []
    if isinstance(existing, list) and existing:
        models = [str(m) for m in existing]
    else:
        models = find_model_mentions(row["source_title"] or "")
    return provider, json.dumps(models, ensure_ascii=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--db", default=str(DEFAULT_DB), help="tokenhub SQLite path")
    parser.add_argument("--apply", action="store_true",
                        help="write the backfill (default: dry run, prints a plan only)")
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
            SELECT id, key_hash, base_url, provider, models, source_title, source_tid, verdict
            FROM token_keys
            WHERE provider = '' OR models IS NULL OR models = '' OR models = '[]'
            ORDER BY id
            """
        ).fetchall()
        if not rows:
            print("nothing to backfill: every row already has provider and models")
            return 0

        plan: list[tuple[str, str, str]] = []
        for row in rows:
            provider, models_json = plan_row(row)
            changes_provider = provider != (row["provider"] or "")
            changes_models = models_json != (row["models"] or "[]")
            if not changes_provider and not changes_models:
                continue
            plan.append((row["id"], provider, models_json))
            title = (row["source_title"] or "")[:34]
            print(f"  {row['id'][:8]} tid={row['source_tid']:<6} verdict={row['verdict']:<11} "
                  f"provider={provider or '-':<22} models={models_json:<24} {title}")

        if not args.apply:
            print(f"\ndry run: {len(plan)} row(s) would be backfilled. "
                  f"Re-run with --apply to write.")
            return 0

        with conn:
            for row_id, provider, models_json in plan:
                conn.execute(
                    "UPDATE token_keys SET provider = ?, models = ?, updated_at = ? WHERE id = ?",
                    (provider, models_json, int(time.time()), row_id),
                )
        print(f"\napplied: {len(plan)} row(s) backfilled")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
