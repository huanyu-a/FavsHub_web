"""Unit tests for the publish layer (07 §5.1 P0-8/P0-9, §5.2, §8.5).

Covers ``publish/feed.py`` (RSS 2.0 snapshot, atomic write) and
``publish/report.py`` (markdown daily report, dated atomic write) against the
acceptance checklist the contract stub carried:

  * full rebuild from the passed entries every cycle, no cross-call state;
  * atomic write (temp file + ``os.replace``) at ``cfg.feed_path`` /
    ``cfg.report_dir``;
  * ``dead`` entries never reach the channel (D3 - the store query already
    drops them, the feed re-checks defensively);
  * never a plaintext key and never ``error_message_raw`` (07 §8.5 rules 1+3);
    C-class entries publish the guide text with an empty ``key_masked`` (D2);
  * XML escaping correct (positive + negative cases), ``pubDate`` RFC 822.

Self-contained per the repo test rule: tempfile directories, in-memory data,
no network, no ``crawler/data/``. Every credential-shaped fixture starts with
``sk-TESTFAKE`` (07 §8.5 task red line).
"""
from __future__ import annotations

import dataclasses
import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import crypto  # noqa: E402
from config import AppConfig  # noqa: E402
from fixtures import FAKE_KEY_PREFIX  # noqa: E402
from interfaces import VERDICT_DEAD, FeedEntry  # noqa: E402
from publish import feed as feed_mod  # noqa: E402
from publish.feed import DISCLAIMER, FEED_DESCRIPTION, FEED_LINK, FEED_TITLE  # noqa: E402
from publish.feed import RssFeed, entry_title, escape  # noqa: E402
from publish.report import REPORT_SECTIONS, DailyReport  # noqa: E402

#: Fabricated credential (07 §8.5: the only allowed prefix). Long enough that
#: :func:`alert.scrub` must treat it as credential-shaped (GENERIC_CREDENTIAL_RE).
FAKE_KEY = FAKE_KEY_PREFIX + "a1b2c3d4e5f6g7h8i9j0"
MASKED = crypto.mask(FAKE_KEY)


def _cfg(tmp: str) -> AppConfig:
    """Config whose data dir is entirely inside ``tmp`` (never crawler/data/)."""
    return AppConfig(
        agg_api_base="https://aggregator.example", ua="test-ua", forums=[2],
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
        key_masked=MASKED, published_at=1735689600,
    )
    values.update(overrides)
    return FeedEntry(**values)


def _items(xml: str):
    root = ET.fromstring(xml)
    return root.findall("./channel/item")


class EscapeTests(unittest.TestCase):
    """XML escaping: positive cases, negative cases, round-trips."""

    def test_escapes_xml_metacharacters(self):
        self.assertEqual(escape('<a href="x">&b'), '&lt;a href="x"&gt;&amp;b')

    def test_none_and_empty_are_safe(self):
        self.assertEqual("", escape(None))
        self.assertEqual("", escape(""))

    def test_round_trip_via_parser(self):
        weird = 'A&B <tag> "q" 🤖 中文'
        text = ET.fromstring(f"<t>{escape(weird)}</t>").text
        self.assertEqual(weird, text)

    def test_strips_chars_xml_cannot_represent(self):
        # XML 1.0 forbids most C0 controls, lone surrogates, U+FFFE/U+FFFF.
        self.assertEqual("abc", escape("a\x0bb\x00c"))
        self.assertEqual("ok", escape("o\ufffek"))

    def test_dirty_title_survives_a_full_build(self):
        feed = RssFeed(_cfg(tempfile.mkdtemp(prefix="tokenhub-feed-")))
        xml = feed.build([_entry(title="坏\x0b标题 <b>&amp;")])
        item = _items(xml)[0]
        self.assertEqual("坏标题 <b>&amp;", item.findtext("title"))


class FeedBuildTests(unittest.TestCase):
    """RSS 2.0 structure + the 07 §8.5 masked-only red lines."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-feed-")
        self.feed = RssFeed(_cfg(self.tmp))

    def test_empty_entries_still_produce_a_valid_feed(self):
        xml = self.feed.build([])
        self.assertTrue(xml.startswith('<?xml version="1.0" encoding="UTF-8"?>'))
        root = ET.fromstring(xml)  # must parse
        self.assertEqual("rss", root.tag)
        self.assertEqual("2.0", root.get("version"))
        self.assertEqual([], root.findall("./channel/item"))
        self.assertTrue(root.findtext("./channel/lastBuildDate"))

    def test_channel_metadata_and_disclaimer(self):
        channel = ET.fromstring(self.feed.build([])).find("./channel")
        self.assertEqual(FEED_TITLE, channel.findtext("title"))
        self.assertEqual(FEED_LINK, channel.findtext("link"))
        self.assertIn("仅供测试", channel.findtext("description"))
        self.assertIn("仅供测试", FEED_DESCRIPTION)

    def test_b_entry_renders_masked_level_only(self):
        description = _items(self.feed.build([_entry()]))[0].findtext("description")
        self.assertIn(f"key: {MASKED}", description)
        self.assertIn("verdict: valid", description)
        self.assertIn("confidence: high", description)
        self.assertIn("base_url: https://api.anthropic.com", description)
        self.assertIn("provider: api.anthropic.com", description)
        self.assertIn(DISCLAIMER, description)

    def test_full_key_never_in_feed_masked_is(self):
        clean = _items(self.feed.build([_entry()]))[0].findtext("description")
        self.assertIn(MASKED, clean)
        # A leaked credential inside the post title must be scrubbed out, while
        # the masked key of a clean entry survives scrubbing untouched.
        xml = self.feed.build([_entry(title=f"领 key {FAKE_KEY} 快来")])
        self.assertNotIn(FAKE_KEY, xml)          # 07 §8.5 rule 1
        self.assertIn("REDACTED", xml)
        self.assertNotIn(f"key: {FAKE_KEY}", xml)
        self.assertIn(f"key: {MASKED}", xml)

    def test_feedentry_cannot_carry_secrets_structurally(self):
        names = {f.name for f in dataclasses.fields(FeedEntry)}
        self.assertIn("key_masked", names)
        for forbidden in ("key", "key_encrypted", "error_message_raw"):
            self.assertNotIn(forbidden, names)

    def test_guide_entry_renders_guide_text_and_no_key(self):
        entry = _entry(category="C", key_masked="",
                       guide_text="回复本主题后即可查看", verdict="unknown")
        item = _items(self.feed.build([entry]))[0]
        description = item.findtext("description")
        self.assertIn("回复本主题后即可查看", description)   # D2: link + 指引
        self.assertNotIn("key:", description)              # no key column at all
        self.assertIn(DISCLAIMER, description)
        self.assertEqual("C", item.findtext("category"))

    def test_dead_entries_never_reach_the_channel(self):
        # D3: the store query already drops dead; the feed re-checks.
        self.assertEqual([], _items(self.feed.build([_entry(verdict=VERDICT_DEAD)])))
        xml = self.feed.build([
            _entry(verdict=VERDICT_DEAD),
            _entry(source_tid=23296, source_url="https://linux.sb/topic/23296"),
        ])
        self.assertEqual(["23296"], [i.findtext("link").rsplit("/", 1)[1] for i in _items(xml)])

    def test_rebuild_is_full_each_cycle(self):
        first = self.feed.build([_entry(source_tid=23295)])
        self.assertIn("23295", first)
        second = self.feed.build(
            [_entry(source_tid=23296, source_url="https://linux.sb/topic/23296")])
        self.assertIn("23296", second)
        self.assertNotIn("23295", second)  # no state carried between builds

    def test_pubdate_is_rfc822(self):
        pub_date = _items(self.feed.build([_entry()]))[0].findtext("pubDate")
        self.assertEqual(1735689600, parsedate_to_datetime(pub_date).timestamp())

    def test_pubdate_without_timestamp_still_parses(self):
        pub_date = _items(self.feed.build([_entry(published_at=0)]))[0].findtext("pubDate")
        self.assertIsNotNone(parsedate_to_datetime(pub_date))

    def test_item_link_and_guid(self):
        item = _items(self.feed.build([_entry()]))[0]
        self.assertEqual("https://linux.sb/topic/23295", item.findtext("link"))
        guid = item.find("guid")
        self.assertEqual("true", guid.get("isPermaLink"))
        self.assertEqual("https://linux.sb/topic/23295", guid.text)

    def test_non_permalink_guid_falls_back_to_source_ids(self):
        entry = _entry(source_url="linux_sb:23295")
        guid = _items(self.feed.build([entry]))[0].find("guid")
        self.assertEqual("false", guid.get("isPermaLink"))
        self.assertEqual("linux_sb:23295", guid.text)

    def test_hostile_title_is_escaped_and_scrubbed(self):
        xml = self.feed.build([_entry(title=f"领 {FAKE_KEY} <script>alert(1)</script>")])
        ET.fromstring(xml)                       # stays well-formed XML
        self.assertNotIn(FAKE_KEY, xml)          # scrubbed
        self.assertNotIn("<script>", xml)        # no injection
        self.assertIn("REDACTED", xml)

    def test_entry_title_falls_back_when_post_title_empty(self):
        entry = _entry(title="  ")
        self.assertEqual("[B] linux_sb#23295", entry_title(entry))


class FeedWriteTests(unittest.TestCase):
    """Atomic write contract: temp file + os.replace at ``cfg.feed_path``."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-feed-")
        self.cfg = _cfg(self.tmp)
        self.feed = RssFeed(self.cfg)

    def test_writes_exactly_to_cfg_feed_path(self):
        path = self.feed.write("<rss/>")
        self.assertEqual(self.cfg.feed_path, path)
        self.assertTrue(os.path.isfile(path))
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual("<rss/>", fh.read())

    def test_repeated_write_replaces_and_leaves_no_temp_files(self):
        self.feed.write("<old/>")
        self.feed.write("<new/>")
        with open(self.feed.path, "r", encoding="utf-8") as fh:
            self.assertEqual("<new/>", fh.read())
        leftovers = [n for n in os.listdir(self.tmp) if n.startswith(".feed-")]
        self.assertEqual([], leftovers)

    def test_write_creates_missing_parent_directories(self):
        nested = RssFeed(_cfg(os.path.join(self.tmp, "nested", "deep")))
        path = nested.write("<rss/>")
        self.assertTrue(os.path.isfile(path))

    def test_write_is_utf8_and_round_trips_unicode(self):
        xml = self.feed.build([_entry(title="中文标题 🤖")])
        self.feed.write(xml)
        with open(self.feed.path, "r", encoding="utf-8") as fh:
            ET.fromstring(fh.read())  # bytes survive the disk round-trip

    def test_write_without_path_raises(self):
        with self.assertRaises(ValueError):
            RssFeed(path="").write("<rss/>")


class ReportBuildTests(unittest.TestCase):
    """Markdown report: contract sections in order + the 07 §5.5 gate numbers."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-report-")
        self.reporter = DailyReport(_cfg(self.tmp))

    def test_sections_present_in_contract_order_as_markdown_headings(self):
        text = self.reporter.build({})
        self.assertTrue(text.startswith("# tokenhub P0 日报"))
        positions = [text.index(f"## {section}") for section in REPORT_SECTIONS]
        self.assertEqual(sorted(positions), positions)

    def test_blank_cycle_renders_zeros(self):
        text = self.reporter.build({})
        self.assertIn("discovered=0", text)
        self.assertIn("matched rules: (none)", text)
        self.assertIn("(no verdict transitions this cycle)", text)
        self.assertIn("probe outcomes: (none)", text)
        self.assertIn("探测异常率=0.0%", text)
        self.assertNotIn("above alert threshold", text)
        self.assertIn("pending stages: (none)", text)

    def test_cycle_numbers_render(self):
        # Class distribution = the 07 §8.1 forum-2 measured counts.
        stats = {
            "discovered": 106, "enriched": 97, "enrich_degraded": 9,
            "watermark_before": 23658, "watermark_after": 23764,
            "categories": {"B": 11, "C": 6, "D": 16, "A": 21, "E": 52},
            "rules": {"B": 11, "C": 6, "D-badge": 16, "A1": 21},
            "credentials": 3, "stored_keys": 2, "stored_guides": 6,
            "stored_by_confidence": {"high": 1, "medium": 1, "low": 0},
            "verdict_changes": [
                {"key_masked": MASKED, "base_url": "https://api.openai.com/v1",
                 "from": "unknown", "to": "dead", "failures": 2, "source_tid": 23764},
                {"key_masked": MASKED, "base_url": "https://api.openai.com/v1",
                 "from": "dead", "to": "valid", "failures": 0, "source_tid": 23600},
            ],
            "probe_verdicts": {"valid": 1, "invalid": 2},
            "probe_errors": 1,                     # -> 1/3 = 33.3% > 20% threshold
            "b_without_credentials": 1,
            "warnings": ["sample degraded step"],
            "aggregator_fallback": True,
            "manual_added": 3, "manual_pending": 7,
            "pending": [],
            "gate": {"by_verdict": {"valid": 2, "quota": 1, "limited": 1, "dead": 1},
                     "by_source": {"reply_visible_guide": 5, "aggregator_leak": 1},
                     "with_two_consecutive_invalids": 3},
        }
        text = self.reporter.build(stats)
        self.assertIn("discovered=106", text)
        self.assertIn("watermark: 23658 -> 23764", text)
        self.assertIn("B=11 C=6 D=16 A=21 E=52", text)
        self.assertIn("D-badge=16", text)
        self.assertIn("keys_stored=2 guides_stored=6", text)
        self.assertIn("confidence: high=1 medium=1 low=0", text)
        self.assertIn("unknown -> dead (failures=2)", text)
        self.assertIn("dead -> valid", text)
        self.assertIn("dead 挽回 (dead -> valid/quota/limited): 1", text)
        self.assertIn("warnings=1 enrich_degraded=9 B 帖零凭证=1", text)
        self.assertIn("probe errors=1 ; 探测异常率=33.3%", text)
        self.assertIn("above alert threshold", text)
        self.assertIn("聚合源回退 (sitemap fallback): yes", text)
        self.assertIn("manual_queue += 3 ; pending=7", text)
        # 07 §5.5 gate numbers.
        self.assertIn("key_output_volume=4", text)      # valid+quota+limited
        self.assertIn("gated_leak_miss=4", text)        # 5 C guides - 1 leak
        self.assertIn("dead=1 / with>=2 consecutive invalids=3", text)

    def test_dead_recovery_counting_ignores_non_output_verdicts(self):
        text = self.reporter.build({
            "verdict_changes": [
                {"key_masked": MASKED, "base_url": "u", "from": "dead", "to": "valid",
                 "failures": 0},
                {"key_masked": MASKED, "base_url": "u", "from": "dead", "to": "unknown",
                 "failures": 0},
            ],
        })
        self.assertIn("dead 挽回 (dead -> valid/quota/limited): 1", text)

    def test_masked_change_line_without_mask_shows_placeholder(self):
        text = self.reporter.build({
            "verdict_changes": [{"key_masked": "", "base_url": "", "from": "x",
                                 "to": "y", "failures": 1}],
        })
        self.assertIn("(masked) @ - : x -> y (failures=1)", text)

    def test_credential_shaped_warning_is_scrubbed_capped_and_truncated(self):
        long_tail = "x" * 500
        warnings = [f"probe failed near {FAKE_KEY}"] + \
                   [f"warn number {i} {long_tail}" for i in range(12)]
        text = self.reporter.build({"warnings": warnings})
        self.assertNotIn(FAKE_KEY, text)             # 07 §8.5: no credential out
        self.assertIn("REDACTED", text)
        self.assertEqual(10, text.count("warn: "))   # capped at 10 lines
        self.assertNotIn(long_tail, text)            # each line truncated to 200

    def test_error_message_raw_stays_audit_only(self):
        # Even if a caller stuffs the audit-only field into stats, build()
        # reads known masked-level fields only and drops unknown keys.
        text = self.reporter.build({"error_message_raw": "SENSITIVE-RAW-ERROR"})
        self.assertNotIn("SENSITIVE-RAW-ERROR", text)
        self.assertNotIn("error_message_raw", text)


class ReportWriteTests(unittest.TestCase):
    """Dated filename under ``cfg.report_dir``, atomic replace, UTF-8."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-report-")
        self.cfg = _cfg(self.tmp)
        self.reporter = DailyReport(self.cfg)

    def test_write_creates_dated_file_under_report_dir(self):
        path = self.reporter.write("第一轮\n")
        self.assertEqual(self.cfg.report_dir, os.path.dirname(path))
        self.assertRegex(os.path.basename(path), r"^\d{4}-\d{2}-\d{2}-\d{4}\.txt$")
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual("第一轮\n", fh.read())

    def test_write_appends_missing_trailing_newline(self):
        path = self.reporter.write("no newline at end")
        with open(path, "r", encoding="utf-8") as fh:
            self.assertEqual("no newline at end\n", fh.read())

    def test_repeated_write_replaces_and_leaves_no_temp_files(self):
        first = self.reporter.write("round one\n")
        second = self.reporter.write("round two\n")
        self.assertEqual(first, second)  # same minute -> same dated file
        with open(second, "r", encoding="utf-8") as fh:
            self.assertEqual("round two\n", fh.read())
        leftovers = [n for n in os.listdir(self.cfg.report_dir)
                     if n.startswith(".report-")]
        self.assertEqual([], leftovers)

    def test_written_report_is_the_scrubbed_markdown(self):
        text = self.reporter.build({"warnings": [f"oops {FAKE_KEY}"]})
        path = self.reporter.write(text)
        with open(path, "r", encoding="utf-8") as fh:
            stored = fh.read()
        self.assertNotIn(FAKE_KEY, stored)           # red line holds on disk
        self.assertIn("## " + REPORT_SECTIONS[0], stored)


if __name__ == "__main__":
    unittest.main()
