"""Schema-migration tests for :mod:`store.db` (stale-database seam bug).

Regression for the live gate failure: ``crawler/data/tokenhub.db`` was created
by an early skeleton build whose ``crawl_state`` had no
``last_sitemap_lastmod`` column, so the first cycle that advanced the watermark
crashed with ``sqlite3.OperationalError: table crawl_state has no column named
last_sitemap_lastmod`` (``set_watermark`` writes it, db.py). ``CREATE TABLE IF
NOT EXISTS`` cannot alter an existing table, so :func:`store.db.init_db` now
applies :func:`store.db.migrate_schema` after the DDL.

Self-contained: in-memory SQLite + one tempfile DB; never ``crawler/data/``.
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from store import db  # noqa: E402

#: The old skeleton shape of ``crawl_state`` (pre-sitemap-bookmark), verbatim
#: from the stale database that broke the gate run.
_OLD_CRAWL_STATE_DDL = """
    CREATE TABLE crawl_state (
      source_id TEXT PRIMARY KEY,
      last_tid INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    )
"""


class MigrateSchemaTests(unittest.TestCase):
    def test_stale_table_gains_missing_column_and_watermark_writes(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        try:
            conn.execute(_OLD_CRAWL_STATE_DDL)
            db.init_db(conn)  # must migrate, not crash
            db.set_watermark(conn, "linux_sb", 24334)
            self.assertEqual(24334, db.get_watermark(conn, "linux_sb"))
            columns = {row[1] for row in conn.execute("PRAGMA table_info(crawl_state)")}
            self.assertIn("last_sitemap_lastmod", columns)
        finally:
            conn.close()

    def test_stale_table_survives_existing_rows(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        try:
            conn.execute(_OLD_CRAWL_STATE_DDL)
            conn.execute(
                "INSERT INTO crawl_state (source_id, last_tid, updated_at) "
                "VALUES ('linux_sb', 42, 1)"
            )
            db.init_db(conn)
            # the existing cursor is kept, and the new column defaults to ''
            self.assertEqual(42, db.get_watermark(conn, "linux_sb"))
            row = db.get_crawl_state(conn, "linux_sb")
            self.assertEqual("", row["last_sitemap_lastmod"])
            # the sitemap bookmark can now be written alongside the cursor
            db.set_watermark(conn, "linux_sb", 42, sitemap_lastmod="2026-09-29T00:00:00+08:00")
            self.assertEqual("2026-09-29T00:00:00+08:00",
                             db.get_crawl_state(conn, "linux_sb")["last_sitemap_lastmod"])
        finally:
            conn.close()

    def test_migration_is_idempotent(self):
        conn = db.connect_in_memory()
        try:
            db.init_db(conn)
            self.assertEqual(0, db.migrate_schema(conn))  # nothing left to apply
            self.assertEqual(0, db.migrate_schema(conn))
            db.set_watermark(conn, "linux_sb", 7)  # still writable after re-runs
            self.assertEqual(7, db.get_watermark(conn, "linux_sb"))
        finally:
            conn.close()

    def test_stale_file_db_round_trip(self):
        """The exact gate scenario: a stale DB FILE, close, reopen, run a cycle."""
        tmp = tempfile.mkdtemp(prefix="tokenhub-migrate-")
        path = os.path.join(tmp, "tokenhub.db")
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        conn.execute(_OLD_CRAWL_STATE_DDL)
        conn.commit()
        conn.close()

        conn = db.connect(path)  # the way main._open_conn opens it
        try:
            db.init_db(conn)
            db.set_watermark(conn, "linux_sb", 24334)
        finally:
            conn.close()

        conn = db.connect(path)
        try:
            self.assertEqual(24334, db.get_watermark(conn, "linux_sb"))
        finally:
            conn.close()

    def test_no_interpolation_in_migration_source(self):
        # same red line as test_store_db: migration SQL is literal constants only
        import inspect

        src = inspect.getsource(db)
        for banned in ("f\"SELECT", "f\"INSERT", "f\"UPDATE", "f\"DELETE",
                       "f\"ALTER", "f\"PRAGMA", ".format("):
            self.assertNotIn(banned, src)


if __name__ == "__main__":
    unittest.main()
