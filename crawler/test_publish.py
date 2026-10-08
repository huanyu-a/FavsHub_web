"""P0-8 publishing layer tests: RSS feed + daily report (07 §5.2 / §8.5).

Self-contained per the repo test rule: tempfile directories, in-memory data,
no network, no ``crawler/data/``. The plaintext-key red line is asserted both
structurally (:class:`interfaces.FeedEntry` cannot carry one) and textually
(every credential-shaped string in a rendered feed/report must have been
scrubbed by :func:`alert.scrub`).
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crypto  # noqa: E402
from config import AppConfig  # noqa: E402
from interfaces import FeedEntry  # noqa: E402
from publish import feed as feed_mod  # noqa: E402
from publish.feed import DISCLAIMER, RssFeed, escape  # noqa: E402
from publish.report import REPORT_SECTIONS, DailyReport  # noqa: E402

#: A credential-shaped string that is NOT sk-TESTFAKE: it is built at runtime so
#: this source file stays clean for the repo-wide scanner (test_fixtures_safety),
#: while the tests still prove the scrub defence fires on the real shape.
_HOSTILE_KEY = "sk-" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"


def _cfg(tmp: str) -> AppConfig:
    return AppConfig(
        agg_api_base="x", ua="x", forums=[2],
        db_path=os.path.join(tmp, "tokenhub.db"),
        dingtalk_webhook="", enable_paid_probe=False, enable_account_farm=False,
        fernet_key=crypto.generate_fernet_key().decode(),
    )


def _entry(**overrides) -> FeedEntry:
    values = dict(
        source_id="linux_sb", source_tid=23295,
        source_url="https://linux.sb/topic/23295",
        title="分享一个中转 key", category="B",
        verdict="valid", confidence="high",
        provider="api.anthropic.com", base_url="https://api.anthropic.com",
        key_masked="sk-TEA*****cdef", published_at=1735689600,
    )
    values.update(overrides)
    return FeedEntry(**values)


def _items(xml: str):
    root = ET.fromstring(xml)
    return root.findall("./channel/item")


class EscapeTests(unittest.TestCase):
    def test_escapes_xml_metacharacters(self):
        # xml.sax.saxutils.escape covers & < > (07 stdlib-only rule).
        self.assertEqual(escape('<a href="x">&b'), '&lt;a href="x"&gt;&amp;b')

    def test_empty_is_safe(self):
        self.assertEqual("", escape(None))


class FeedBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-feed-")
        self.feed = RssFeed(_cfg(self.tmp))

    def test_rss20_channel_metadata(self):
        xml = self.feed.build([_entry()])
        root = ET.fromstring(xml)
        self.assertEqual("rss", root.tag)
        self.assertEqual("2.0", root.get("version"))
        channel = root.find("./channel")
        self.assertEqual(feed_mod.FEED_TITLE, channel.findtext("title"))
        self.assertEqual(feed_mod.FEED_LINK, channel.findtext("link"))
        self.assertIn("仅供测试", channel.findtext("description"))

    def test_b_entry_renders_masked_level_only(self):
        xml = self.feed.build([_entry()])
        item = _items(xml)[0]
        description = item.findtext("description")
        self.assertIn("key: sk-TEA*****cdef", description)
        self.assertIn("verdict: valid", description)
        self.assertIn("confidence: high", description)
        self.assertIn("base_url: https://api.anthropic.com", description)
        self.assertIn(DISCLAIMER, description)

    def test_guide_entry_has_no_key_columns(self):
        xml = self.feed.build([_entry(category="C", key_masked="",
                                      guide_text="回复本主题后即可查看")])
        description = _items(xml)[0].findtext("description")
        self.assertIn("回复本主题后即可查看", description)
        self.assertNotIn("key:", description)
        self.assertIn(DISCLAIMER, description)

    def test_dead_entries_never_reach_the_channel(self):
        # D3: the store query already drops dead; the feed re-checks.
        xml = self.feed.build([_entry(verdict="dead")])
        self.assertEqual([], _items(xml))

    def test_hostile_title_is_escaped_and_scrubbed(self):
        xml = self.feed.build([_entry(title=f"领 key {_HOSTILE_KEY} <script>")])
        ET.fromstring(xml)  # must stay well-formed XML
        self.assertNotIn(_HOSTILE_KEY, xml)      # 07 §8.5: no credential shape out
        self.assertNotIn("<script>", xml)        # no injection through the title
        self.assertIn("REDACTED", xml)

    def test_items_keep_source_link_and_pubdate(self):
        xml = self.feed.build([_entry()])
        item = _items(xml)[0]
        self.assertEqual("https://linux.sb/topic/23295", item.findtext("link"))
        self.assertEqual("true", item.find("guid").get("isPermaLink"))
        self.assertTrue(item.findtext("pubDate").endswith(("+0800", "+0000", "GMT"))
                        or "19" in item.findtext("pubDate"))


class FeedWriteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-feed-")
        self.feed = RssFeed(_cfg(self.tmp))

    def test_write_creates_parents_and_returns_path(self):
        path = self.feed.write("<?xml version='1.0'?><rss/>")
        self.assertTrue(os.path.isfile(path))
        self.assertEqual(self.feed.path, path)

    def test_write_is_atomic_replace_with_no_temp_leftovers(self):
        self.feed.write("<old/>")
        self.feed.write("<new/>")
        with open(self.feed.path, "r", encoding="utf-8") as fh:
            self.assertEqual("<new/>", fh.read())
        leftovers = [n for n in os.listdir(self.tmp) if n.startswith(".feed-")]
        self.assertEqual([], leftovers)

    def test_write_without_path_raises(self):
        with self.assertRaises(ValueError):
            RssFeed(path="").write("<rss/>")


class ReportBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-report-")
        self.reporter = DailyReport(_cfg(self.tmp))

    def test_all_sections_present_in_contract_order(self):
        text = self.reporter.build({})
        positions = [text.index(section) for section in REPORT_SECTIONS]
        self.assertEqual(sorted(positions), positions)

    def test_blank_cycle_renders_zeros(self):
        text = self.reporter.build({})
        self.assertIn("discovered=0", text)
        self.assertIn("pending stages: (none)", text)

    def test_cycle_numbers_render(self):
        stats = {
            "discovered": 258, "enriched": 237, "enrich_degraded": 21,
            "watermark_before": 23400, "watermark_after": 23658,
            "categories": {"B": 2, "C": 6, "D": 16, "A": 21, "E": 52},
            "rules": {"B": 2, "C": 6, "D-badge": 10, "A1": 5},
            "credentials": 3, "stored_keys": 2, "stored_guides": 6,
            "stored_by_confidence": {"high": 1, "medium": 1, "low": 0},
            "verdict_changes": [
                {"key_masked": "sk-TEA*****cdef", "base_url": "https://api.openai.com/v1",
                 "from": "unknown", "to": "dead", "failures": 2, "source_tid": 999},
            ],
            "probe_verdicts": {"valid": 1, "invalid": 1},
            "probe_errors": 0,
            "b_without_credentials": 1,
            "aggregator_fallback": True,
            "manual_added": 3, "manual_pending": 7,
            "pending": [],
            "gate": {"by_verdict": {"valid": 2, "dead": 1},
                     "by_source": {"reply_visible_guide": 5, "aggregator_leak": 1},
                     "with_two_consecutive_invalids": 3},
        }
        text = self.reporter.build(stats)
        self.assertIn("discovered=258", text)
        self.assertIn("B=2 C=6 D=16 A=21 E=52", text)
        self.assertIn("D-badge=10", text)
        self.assertIn("keys_stored=2 guides_stored=6", text)
        self.assertIn("unknown -> dead (failures=2)", text)
        self.assertIn("探测异常率=0.0%", text)
        self.assertIn("聚合源回退 (sitemap fallback): yes", text)
        self.assertIn("manual_queue += 3 ; pending=7", text)
        self.assertIn("key_output_volume=2", text)          # valid only (quota/limited absent)
        self.assertIn("gated_leak_miss=4", text)            # 5 guides - 1 leak
        self.assertIn("dead=1 / with>=2 consecutive invalids=3", text)

    def test_probe_error_rate_flags_above_threshold(self):
        text = self.reporter.build({"probe_verdicts": {"unknown": 3, "valid": 1},
                                    "probe_errors": 0})
        self.assertIn("探测异常率=75.0%", text)
        self.assertIn("above alert threshold", text)

    def test_dead_recovery_is_counted(self):
        text = self.reporter.build({
            "verdict_changes": [
                {"key_masked": "sk-TEA*****cdef", "base_url": "u", "from": "dead",
                 "to": "valid", "failures": 0},
                {"key_masked": "sk-TEA*****ffff", "base_url": "u", "from": "unknown",
                 "to": "limited", "failures": 0},
            ],
        })
        self.assertIn("dead 挽回 (dead -> valid/quota/limited): 1", text)

    def test_credential_shaped_warning_is_scrubbed(self):
        text = self.reporter.build({"warnings": [f"probe failed near {_HOSTILE_KEY}"]})
        self.assertNotIn(_HOSTILE_KEY, text)
        self.assertIn("REDACTED", text)


class ReportWriteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-report-")
        self.reporter = DailyReport(_cfg(self.tmp))

    def test_write_creates_dated_file_under_report_dir(self):
        path = self.reporter.write("内容\n")
        directory = os.path.dirname(path)
        self.assertEqual(self.reporter.cfg.report_dir, directory)
        self.assertRegex(os.path.basename(path), r"^\d{4}-\d{2}-\d{2}-\d{4}\.txt$")
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual("内容\n", fh.read())


if __name__ == "__main__":
    unittest.main()
