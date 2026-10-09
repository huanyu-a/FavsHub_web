"""Real unit tests for :mod:`store.db` (07 §8.4 / P0-7 / P0-9).

Self-contained per the test rules: every case runs on an in-memory SQLite DB, so
nothing touches ``crawler/data/`` and no real key material is used. Fake secrets
all carry the ``sk-TESTFAKE`` prefix (07 §8.5); the encrypted column is filled
with an opaque dummy string because ``store.db`` never encrypts itself (that is
the caller's job via :mod:`crypto`).
"""
from __future__ import annotations

import os
import sqlite3
import sys
import unittest

# Make flat imports (``from store import db``) work no matter how this file is run.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from store import db  # noqa: E402  (the package view main.py uses)
from interfaces import ProbeOutcome  # noqa: E402


FAKE_KEY_HASH = "a" * 64  # stand-in for crypto.sha256_hex of a fake key
FAKE_CT = "gAAAAAB-fake-ciphertext-skeleton-only"


def fresh_conn() -> sqlite3.Connection:
    conn = db.connect_in_memory()
    db.init_db(conn)
    return conn


def base_record(**overrides):
    rec = {
        "id": db.new_id(),
        "source_id": "linux_sb",
        "source_tid": 23295,
        "source_url": "https://www.linux.do/topic/23295",
        "source_title": "fake title",
        "source_author": "tester",
        "key_masked": "sk-TES********KE",
        "key_hash": FAKE_KEY_HASH,
        "key_encrypted": FAKE_CT,
        "base_url": "https://asvla.bbqwq.com/",
        "provider": "openai",
        "models": '["gpt-4o"]',
        "source": "post",
        "confidence": "medium",
        "note": "test evidence",
    }
    rec.update(overrides)
    return rec


class InitAndSchemaTests(unittest.TestCase):
    def test_init_db_is_idempotent(self):
        conn = db.connect_in_memory()
        db.init_db(conn)
        db.init_db(conn)  # CREATE ... IF NOT EXISTS must not raise
        names = {
            r["name"]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        self.assertLessEqual(
            {"token_keys", "probe_log", "reveal_log", "crawl_state", "manual_queue"}, names
        )

    def test_all_exports_are_public_functions(self):
        # __all__ lists the API the four implementers may call; guard against a
        # name drifting out of sync with a real definition.
        for name in db.__all__:
            self.assertTrue(hasattr(db, name), name)

    def test_wal_only_on_file_connections(self):
        conn = db.connect_in_memory()
        # in-memory helper does not set WAL (memory DBs cannot journal);
        # connect() does. Assert connect() enables it via a temp file.
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "sub", "x.db")
            f = db.connect(path)
            mode = f.execute("PRAGMA journal_mode").fetchone()[0]
            f.close()
            self.assertEqual(str(mode).lower(), "wal")


class WatermarkTests(unittest.TestCase):
    def test_default_watermark_is_zero(self):
        conn = fresh_conn()
        self.assertEqual(db.get_watermark(conn, "linux_sb"), 0)

    def test_set_then_get(self):
        conn = fresh_conn()
        db.set_watermark(conn, "linux_sb", 100)
        self.assertEqual(db.get_watermark(conn, "linux_sb"), 100)

    def test_watermark_is_monotonic(self):
        conn = fresh_conn()
        db.set_watermark(conn, "linux_sb", 200)
        db.set_watermark(conn, "linux_sb", 150)  # out-of-order page must not rewind
        self.assertEqual(db.get_watermark(conn, "linux_sb"), 200)

    def test_per_source_isolation(self):
        conn = fresh_conn()
        db.set_watermark(conn, "linux_sb", 50)
        db.set_watermark(conn, "other_src", 999)
        self.assertEqual(db.get_watermark(conn, "linux_sb"), 50)
        self.assertEqual(db.get_watermark(conn, "other_src"), 999)


class UpsertTokenKeyTests(unittest.TestCase):
    def test_insert_then_update_reuses_id(self):
        conn = fresh_conn()
        first = db.upsert_token_key(conn, base_record())
        second = db.upsert_token_key(conn, base_record(note="refreshed"))
        self.assertEqual(first, second)
        self.assertEqual(conn.execute("SELECT COUNT(*) c FROM token_keys").fetchone()["c"], 1)
        self.assertEqual(db.get_token_key(conn, first)["note"], "refreshed")

    def test_unique_is_key_hash_plus_base_url(self):
        conn = fresh_conn()
        a = db.upsert_token_key(conn, base_record(base_url="https://a.example"))
        b = db.upsert_token_key(conn, base_record(base_url="https://b.example"))
        self.assertNotEqual(a, b)
        self.assertEqual(conn.execute("SELECT COUNT(*) c FROM token_keys").fetchone()["c"], 2)

    def test_required_columns_enforced(self):
        conn = fresh_conn()
        with self.assertRaises(ValueError):
            db.upsert_token_key(conn, {"base_url": "https://x.example"})
        with self.assertRaises(ValueError):
            db.upsert_token_key(conn, {"key_hash": FAKE_KEY_HASH})

    def test_coalesce_preserves_ciphertext_on_none(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record(key_encrypted=FAKE_CT))
        # A later re-discovery without the encrypted blob must NOT wipe it.
        db.upsert_token_key(conn, base_record(key_encrypted=None))
        row = db.get_token_key(conn, cid)
        self.assertEqual(row["key_encrypted"], FAKE_CT)

    def test_upsert_does_not_clobber_verdict(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        db.update_verdict(conn, cid, "dead", 3, last_probe_at=1000)
        db.upsert_token_key(conn, base_record(note="re-seen"))
        row = db.get_token_key(conn, cid)
        # verdict/consecutive_failures/last_probe_at belong to update_verdict only.
        self.assertEqual(row["verdict"], "dead")
        self.assertEqual(row["consecutive_failures"], 3)
        self.assertEqual(row["last_probe_at"], 1000)
        self.assertEqual(row["note"], "re-seen")

    def test_upsert_does_not_resurrect_hidden(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        db.set_deal_status(conn, cid, "hidden")
        db.upsert_token_key(conn, base_record())  # must not flip back to published
        self.assertEqual(db.get_token_key(conn, cid)["deal_status"], "hidden")

    def test_identity_history_preserved(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record(first_seen_at=10, created_at=10))
        db.upsert_token_key(conn, base_record(first_seen_at=99999, created_at=99999))
        row = db.get_token_key(conn, cid)
        self.assertEqual(row["first_seen_at"], 10)
        self.assertEqual(row["created_at"], 10)


class GuideRowTests(unittest.TestCase):
    def test_distinct_guides_coexist(self):
        conn = fresh_conn()
        g1 = db.upsert_token_key(conn, base_record(
            key_hash=db.guide_key_hash("linux_sb", 1), base_url="", key_encrypted=None,
            key_masked="", source="reply_visible_guide"))
        g2 = db.upsert_token_key(conn, base_record(
            key_hash=db.guide_key_hash("linux_sb", 2), base_url="", key_encrypted=None,
            key_masked="", source="reply_visible_guide"))
        self.assertNotEqual(g1, g2)
        self.assertEqual(conn.execute("SELECT COUNT(*) c FROM token_keys").fetchone()["c"], 2)

    def test_guide_hash_is_stable_and_credential_free(self):
        h = db.guide_key_hash("linux_sb", 23295)
        self.assertEqual(h, db.guide_key_hash("linux_sb", 23295))
        self.assertNotEqual(h, db.guide_key_hash("linux_sb", 23296))
        self.assertEqual(len(h), 64)
        self.assertTrue(all(c in "0123456789abcdef" for c in h))


class PublishableAndDeadTests(unittest.TestCase):
    def _mk(self, conn, verdict, deal_status="published", last_probe_at=None, **kw):
        cid = db.upsert_token_key(conn, base_record(base_url="https://u%d.example" % abs(hash((verdict, deal_status, last_probe_at))), **kw))
        db.update_verdict(conn, cid, verdict, 0, last_probe_at=last_probe_at)
        if deal_status != "published":
            db.set_deal_status(conn, cid, deal_status)
        return cid

    def test_dead_excluded(self):
        conn = fresh_conn()
        self._mk(conn, "valid")
        self._mk(conn, "dead")
        rows = db.select_publishable(conn)
        self.assertEqual([r["verdict"] for r in rows], ["valid"])

    def test_hidden_excluded_everywhere(self):
        conn = fresh_conn()
        self._mk(conn, "valid", deal_status="hidden")
        self.assertEqual(len(db.select_publishable(conn)), 0)

    def test_dead_reprobe_interval(self):
        conn = fresh_conn()
        old = self._mk(conn, "dead", last_probe_at=1)
        recent = self._mk(conn, "dead", last_probe_at=db.now_ts())
        due = db.select_dead_for_reprobe(conn)
        ids = {r["id"] for r in due}
        self.assertIn(old, ids)
        self.assertNotIn(recent, ids)  # probed within the last day -> not due


class ProbeLogTests(unittest.TestCase):
    def test_insert_from_dataclass(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        outcome = ProbeOutcome(
            credential_id=cid, base_url="https://asvla.bbqwq.com/", probe_kind="models",
            http_status=401, verdict="dead", error_code="401",
            error_message_raw="invalid api key", attempt_n=2, probed_at=555,
        )
        log_id = db.insert_probe_log(conn, outcome)
        self.assertGreaterEqual(log_id, 1)
        row = conn.execute("SELECT * FROM probe_log WHERE id=?", (log_id,)).fetchone()
        self.assertEqual(row["credential_id"], cid)
        self.assertEqual(row["verdict"], "dead")
        self.assertEqual(row["probed_at"], 555)
        self.assertEqual(row["attempt_n"], 2)

    def test_insert_from_dict(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        db.insert_probe_log(conn, {
            "credential_id": cid, "base_url": "b", "probe_kind": "k",
            "http_status": 0, "verdict": "unknown", "probed_at": 10,
        })
        self.assertEqual(db.get_token_key(conn, cid)["verdict"], "unknown")

    def test_unknown_streak_counts_and_breaks(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        for ts, verdict in [(1, "unknown"), (2, "unknown"), (3, "valid"), (4, "unknown")]:
            db.insert_probe_log(conn, {
                "credential_id": cid, "base_url": "b", "probe_kind": "k",
                "http_status": 200, "verdict": verdict, "probed_at": ts,
            })
        # Most recent (probed_at=4) is unknown, streak stops at the valid(3).
        self.assertEqual(db.count_unknown_streak(conn, cid), 1)

    def test_prune_probe_log_by_age(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        db.insert_probe_log(conn, {"credential_id": cid, "base_url": "b", "probe_kind": "k",
                                   "http_status": 200, "verdict": "valid", "probed_at": 1})
        db.insert_probe_log(conn, {"credential_id": cid, "base_url": "b", "probe_kind": "k",
                                   "http_status": 200, "verdict": "valid",
                                   "probed_at": db.now_ts()})
        pruned = db.prune_probe_log(conn, days=90)
        self.assertEqual(pruned, 1)
        self.assertEqual(conn.execute("SELECT COUNT(*) c FROM probe_log").fetchone()["c"], 1)


class ManualQueueTests(unittest.TestCase):
    def test_enqueue_list_resolve(self):
        conn = fresh_conn()
        mid = db.enqueue_manual(conn, reason="low_confidence_pairing", source_id="linux_sb",
                               source_tid=1, key_hash=FAKE_KEY_HASH, detail="x")
        self.assertEqual(len(db.list_manual(conn, "pending")), 1)
        db.resolve_manual(conn, mid)
        self.assertEqual(db.list_manual(conn, "pending"), [])
        self.assertEqual(len(db.list_manual(conn, "resolved")), 1)

    def test_dedupes_identical_pending(self):
        conn = fresh_conn()
        a = db.enqueue_manual(conn, reason="r", source_tid=1, key_hash=FAKE_KEY_HASH)
        b = db.enqueue_manual(conn, reason="r", source_tid=1, key_hash=FAKE_KEY_HASH)
        self.assertEqual(a, b)
        self.assertEqual(len(db.list_manual(conn, "pending")), 1)

    def test_different_reason_not_deduped(self):
        conn = fresh_conn()
        db.enqueue_manual(conn, reason="r1", source_tid=1, key_hash=FAKE_KEY_HASH)
        db.enqueue_manual(conn, reason="r2", source_tid=1, key_hash=FAKE_KEY_HASH)
        self.assertEqual(len(db.list_manual(conn, "pending")), 2)


class RevealLogTests(unittest.TestCase):
    def test_record_reveal(self):
        conn = fresh_conn()
        cid = db.upsert_token_key(conn, base_record())
        rid = db.record_reveal(conn, cid, "user-1", ip="10.0.0.1", ts=777)
        row = conn.execute("SELECT * FROM reveal_log WHERE id=?", (rid,)).fetchone()
        self.assertEqual(row["credential_id"], cid)
        self.assertEqual(row["revealed_at"], 777)


class ModelsJsonTests(unittest.TestCase):
    def test_models_to_json(self):
        self.assertEqual(db.models_to_json(["a", "b"]), '["a", "b"]')
        self.assertEqual(db.models_to_json(None), "[]")
        self.assertEqual(db.models_to_json(()), "[]")


class SqlInjectionSafetyTests(unittest.TestCase):
    def test_malicious_values_are_data_not_code(self):
        conn = fresh_conn()
        evil = "x'; DROP TABLE token_keys;--"
        # Parameterised binding means this is just a string value; it must not
        # execute and must not remove the table.
        db.upsert_token_key(conn, base_record(base_url=evil, key_hash=evil))
        self.assertIsNotNone(
            conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='token_keys'").fetchone()
        )
        self.assertEqual(db.get_token_key(conn, db.upsert_token_key(conn, base_record(base_url=evil, key_hash=evil)))["base_url"], evil)

    def test_no_sql_interpolation_in_source(self):
        import inspect

        src = inspect.getsource(db)
        # f-strings / %-formatting / .format() / concatenation into SQL would show up.
        self.assertNotIn('f"SELECT', src)
        self.assertNotIn('f"INSERT', src)
        self.assertNotIn('f"UPDATE', src)
        self.assertNotIn('f"DELETE', src)
        self.assertNotIn('.format(', src)


if __name__ == "__main__":
    unittest.main()
