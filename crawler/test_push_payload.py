"""Payload-contract tests for ``scripts/push_to_favshub.py`` (2026-10-09).

Why this file exists
--------------------
The crawler stores ``token_keys.models`` as a **JSON string** (``'[]'`` /
``'["DeepSeek"]'``, ``store/db.py:models_to_json``), while the site's F4
``normalizeModels`` (``mem Model``, ``favshub-nuxt/server/utils/token-deals.ts:63``)
accepts an **array** only and silently returns ``[]`` for anything else. The two
sides agreed on the column but not on the wire shape, and nobody could notice
while every row held the empty array: the push reported ``upserted:13`` and the
site stored ``[]`` (measured against production on 2026-10-09).

This is the seam test: the payload builder must hand the site a list, and the
masked/whitelist discipline around it must stay intact.

Runs the real ``normalize()`` from the real script (imported by path - the
module lives outside the crawler package). No network, no DB, no real key:
``push_to_favshub`` imports ``cryptography`` lazily inside the decrypt helper,
so importing it is cheap and offline.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

CRAWLER_ROOT = os.path.dirname(os.path.abspath(__file__))
PUSH_SCRIPT = os.path.join(os.path.dirname(CRAWLER_ROOT), "scripts", "push_to_favshub.py")


def _load_push_module():
    spec = importlib.util.spec_from_file_location("push_to_favshub_under_test", PUSH_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PUSH = _load_push_module()


def _row(**overrides):
    """A minimal valid source row (the shape ``fetch_rows`` returns)."""
    row = {
        "key_hash": "a" * 64,
        "base_url": "https://relay.example.test/v1",
        "key_masked": "sk-TESTFAKE...0000",
        "provider": "relay.example.test",
        "models": "[]",
        "source": "post",
        "confidence": "high",
        "verdict": "valid",
        "source_id": "linux_sb",
        "source_tid": 23531,
        "source_url": "https://linux.sb/topic/23531",
        "source_title": "免费token",
        "source_author": "tester",
        "consecutive_failures": 0,
        "last_probe_at": 1770000000,
        "first_seen_at": 1770000000,
        "post_time": "2026-10-09 12:00",
        "note": "same line",
    }
    row.update(overrides)
    return row


class ModelsWireShapeTests(unittest.TestCase):
    """The F4 payload must carry ``models`` as an array, never as a JSON string."""

    def test_json_string_becomes_a_list(self):
        body, reason = PUSH.normalize(_row(models='["DeepSeek"]'))
        self.assertEqual("", reason)
        self.assertEqual(["DeepSeek"], body["models"])

    def test_multiple_models_and_unicode_survive(self):
        body, _ = PUSH.normalize(_row(models='["Claude Opus 5.5", "Grok 4.6"]'))
        self.assertEqual(["Claude Opus 5.5", "Grok 4.6"], body["models"])

    def test_empty_json_array_stays_empty(self):
        body, _ = PUSH.normalize(_row(models="[]"))
        self.assertEqual([], body["models"])

    def test_malformed_json_degrades_to_empty_not_a_crash(self):
        for bad in ("not json", "[", '{"a":1}', "null"):
            with self.subTest(bad=bad):
                body, reason = PUSH.normalize(_row(models=bad))
                self.assertEqual("", reason)
                self.assertEqual([], body["models"])

    def test_an_already_decoded_list_is_preserved(self):
        # Defensive: a future caller may fetch rows with a json converter.
        body, _ = PUSH.normalize(_row(models=["Qwen"]))
        self.assertEqual(["Qwen"], body["models"])

    def test_wire_payload_is_json_serialisable(self):
        body, _ = PUSH.normalize(_row(models='["DeepSeek"]'))
        round_tripped = json.loads(json.dumps(body, ensure_ascii=False))
        self.assertEqual(["DeepSeek"], round_tripped["models"])


class PayloadDisciplineTests(unittest.TestCase):
    """Field whitelist / verdict gate / no key material in the payload."""

    def test_field_whitelist_is_exactly_the_contract(self):
        body, _ = PUSH.normalize(_row())
        self.assertEqual(set(PUSH.FIELD_MAP), set(body))

    def test_local_only_columns_never_reach_the_payload(self):
        body, _ = PUSH.normalize(_row(key_encrypted="gAAAAA-not-sent"))
        self.assertNotIn("key_encrypted", body)
        self.assertNotIn("gAAAAA-not-sent", json.dumps(body))

    def test_unknown_verdict_is_skipped_with_a_reason(self):
        body, reason = PUSH.normalize(_row(verdict="bogus"))
        self.assertIsNone(body)
        self.assertIn("verdict", reason)

    def test_every_whitelisted_verdict_passes(self):
        for verdict in PUSH.VERDICTS:
            with self.subTest(verdict=verdict):
                body, reason = PUSH.normalize(_row(verdict=verdict))
                self.assertEqual("", reason, verdict)
                self.assertEqual(verdict, body["verdict"])

    def test_empty_key_hash_is_skipped(self):
        body, reason = PUSH.normalize(_row(key_hash=""))
        self.assertIsNone(body)
        self.assertIn("key_hash", reason)

    def test_plain_key_is_attached_only_when_present(self):
        body, _ = PUSH.normalize(_row())
        self.assertNotIn("key_plain", body)
        body, _ = PUSH.normalize(_row(), plain="sk-TESTFAKE" + "a" * 40)
        self.assertEqual("sk-TESTFAKE" + "a" * 40, body["key_plain"])

    def test_provider_passes_through_unchanged(self):
        body, _ = PUSH.normalize(_row(provider="xlai.pro"))
        self.assertEqual("xlai.pro", body["provider"])


if __name__ == "__main__":
    unittest.main()
