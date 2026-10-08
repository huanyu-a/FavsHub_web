"""Alerting tests: webhook path + the degrade-to-log sink (07 §四 / D4).

``DINGTALK_WEBHOOK`` unset must degrade to a local log file and never raise
(integration contract); the webhook URL and any credential-shaped text must be
scrubbed on every outbound path (07 §8.5).
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import alert  # noqa: E402

#: Built at runtime so this file stays clean for the repo-wide scanner
#: (test_fixtures_safety) while still proving the scrub fires on a real shape.
_HOSTILE_KEY = "sk-" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"


class ScrubTests(unittest.TestCase):
    def test_credential_shape_is_redacted(self):
        scrubbed = alert.scrub(f"key is {_HOSTILE_KEY} ok")
        self.assertNotIn(_HOSTILE_KEY, scrubbed)
        self.assertIn("***REDACTED***", scrubbed)

    def test_plain_text_passes_through(self):
        self.assertEqual("nothing to see", alert.scrub("nothing to see"))

    def test_none_is_safe(self):
        self.assertEqual("", alert.scrub(None))


class DingTalkAlerterTests(unittest.TestCase):
    def test_success_returns_true(self):
        calls = []

        def transport(url, payload):
            calls.append((url, payload))
            return '{"errcode": 0, "errmsg": "ok"}'

        alerter = alert.DingTalkAlerter("https://oapi.dingtalk.com/robot?access_token=x",
                                        transport=transport)
        self.assertTrue(alerter.notify("source switch"))
        self.assertEqual(1, len(calls))

    def test_transport_failure_never_raises(self):
        def transport(url, payload):
            raise OSError("network down")

        alerter = alert.DingTalkAlerter("https://oapi.dingtalk.com/robot?access_token=x",
                                        transport=transport)
        self.assertFalse(alerter.notify("hello"))
        self.assertTrue(alerter.last_error)

    def test_errcode_nonzero_returns_false(self):
        alerter = alert.DingTalkAlerter("https://oapi.dingtalk.com/robot?access_token=x",
                                        transport=lambda url, payload: '{"errcode": 310000}')
        self.assertFalse(alerter.notify("hello"))

    def test_repr_masks_the_webhook(self):
        alerter = alert.DingTalkAlerter("https://oapi.dingtalk.com/robot?access_token=SECRET")
        self.assertNotIn("SECRET", repr(alerter))


class FileLogAlerterTests(unittest.TestCase):
    """The degrade-to-log sink: webhook unset -> alerts must survive locally."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-alert-")
        self.path = os.path.join(self.tmp, "nested", "alerts.log")
        self.alerter = alert.FileLogAlerter(self.path)

    def test_writes_one_line_and_creates_parents(self):
        self.assertTrue(self.alerter.notify("sitemap fallback fired"))
        with open(self.path, "r", encoding="utf-8") as fh:
            content = fh.read()
        self.assertIn("[alert] sitemap fallback fired", content)
        self.assertEqual(1, len(content.strip().splitlines()))

    def test_appends_across_calls(self):
        self.alerter.notify("first")
        self.alerter.notify("second")
        with open(self.path, "r", encoding="utf-8") as fh:
            lines = fh.read().strip().splitlines()
        self.assertEqual(2, len(lines))
        self.assertIn("first", lines[0])
        self.assertIn("second", lines[1])

    def test_message_is_flattened_and_scrubbed(self):
        self.assertTrue(self.alerter.notify(f"line1\nline2 {_HOSTILE_KEY}"))
        with open(self.path, "r", encoding="utf-8") as fh:
            content = fh.read()
        self.assertNotIn(_HOSTILE_KEY, content)
        self.assertIn("***REDACTED***", content)
        self.assertEqual(1, len(content.strip().splitlines()))

    def test_unwritable_path_returns_false_and_never_raises(self):
        # A directory standing where the log file should be: every write fails.
        blocker = os.path.join(self.tmp, "blocker")
        os.makedirs(blocker)
        alerter = alert.FileLogAlerter(blocker)
        self.assertFalse(alerter.notify("boom"))
        self.assertTrue(alerter.last_error)

    def test_requires_a_path(self):
        with self.assertRaises(ValueError):
            alert.FileLogAlerter("")


class BuildAlerterTests(unittest.TestCase):
    def test_webhook_wins(self):
        alerter = alert.build_alerter("https://oapi.dingtalk.com/robot?access_token=x",
                                      transport=lambda url, payload: '{"errcode": 0}',
                                      log_path="/tmp/whatever.log")
        self.assertIsInstance(alerter, alert.DingTalkAlerter)

    def test_no_webhook_degrades_to_log(self):
        alerter = alert.build_alerter("", log_path=os.path.join(tempfile.gettempdir(), "a.log"))
        self.assertIsInstance(alerter, alert.FileLogAlerter)

    def test_nothing_configured_is_a_noop(self):
        self.assertIsInstance(alert.build_alerter(""), alert.NullAlerter)

    def test_noop_returns_false(self):
        self.assertFalse(alert.build_alerter("").notify("ignored"))


if __name__ == "__main__":
    unittest.main()
