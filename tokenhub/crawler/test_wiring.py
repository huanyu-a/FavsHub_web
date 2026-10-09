"""End-to-end wiring tests for ``main.run_cycle`` (07 §四 / §5, integration).

Drives the REAL pipeline stages (store, classify rules, extractor, verdict
state machine, feed, report) with only the network edges faked (adapter,
prober, alerter), so every seam the integration owns is exercised:

  * B post -> store (masked+hash+Fernet) -> probe -> verdict -> feed;
  * C post -> ``reply_visible_guide`` row with zero key data (D2);
  * D post -> ``manual_queue`` ``card_or_paid_benefit_info``, never extracted
    nor probed (07 §8.1 D row);
  * suspected E -> ``manual_queue`` ``suspected_valuable_E`` (P0-9);
  * two consistent invalid rounds 30s+ apart -> ``dead`` and out of the feed
    (07 §8.3 / §5.4 ⑤), one probe_log row per round;
  * unknown for 5 undecided rounds -> ``unknown_5_rounds`` escalation;
  * watermark advances and the next round re-discovers nothing (§5.4 ①);
  * sitemap-fallback warnings surface in the summary and fire one alert.

Self-contained: tempfile dirs, in-memory SQLite, no network, no
``crawler/data/``, only ``sk-TESTFAKE`` shaped keys.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crypto  # noqa: E402
import main  # noqa: E402
from classify.rules_linux_sb import linux_sb_rules  # noqa: E402
from config import AppConfig  # noqa: E402
from interfaces import (  # noqa: E402
    CATEGORY_E,
    FullPost,
    ProbeOutcome,
    Prober,
    RawPost,
)
from publish.feed import RssFeed  # noqa: E402
from publish.report import DailyReport  # noqa: E402
from store import db  # noqa: E402

FAKE_KEY = "sk-TESTFAKE0123456789abcdef"   # scanner-safe fake (07 §8.5 rule)
RELAY_URL = "https://relay.example.com/v1"


def _cfg(tmp: str, fernet_key: str = None) -> AppConfig:
    return AppConfig(
        agg_api_base="x", ua="x", forums=[2],
        db_path=os.path.join(tmp, "tokenhub.db"),
        dingtalk_webhook="", enable_paid_probe=False, enable_account_farm=False,
        # None -> generate; "" -> deliberately unset (the 07 §8.5 no-plaintext path)
        fernet_key=(crypto.generate_fernet_key().decode()
                    if fernet_key is None else fernet_key),
    )


def _post(tid: int, body: str, title: str = "分享", **full_kwargs) -> FullPost:
    raw = RawPost(tid=tid, title=title, forum_id=2, forum_name="福利放送",
                  author_name="tester", url=f"https://linux.sb/topic/{tid}",
                  content_text=body)
    return FullPost(raw=raw, article_body=body, enriched=True, **full_kwargs)


class _FakeAdapter:
    """Offline adapter: replays prepared posts, honours the tid watermark."""

    source_id = "linux_sb"

    def __init__(self, fulls, rules=()):
        self._fulls = list(fulls)
        self._rules = list(rules)
        self.discover_since = []
        self.warnings = []
        self.pending_alerts = []

    def discover(self, since_tid):
        self.discover_since.append(since_tid)
        return [full.raw for full in self._fulls if full.raw.tid > since_tid]

    def enrich(self, post):
        for full in self._fulls:
            if full.raw.tid == post.tid:
                return full
        raise AssertionError(f"unexpected enrich tid={post.tid}")

    def classify_rules(self):
        return list(self._rules)


class _ScriptedProber(Prober):
    """Canned (http_status, verdict) per base_url; records every call.

    The clock starts at the real epoch so ``probed_at`` stays consistent with
    the wall-clock timestamps ``store.db`` uses for the 24h dead-reprobe
    window; tests move it forward in whole seconds to model elapsed time.
    """

    def __init__(self):
        import time

        self.calls = []
        self.script = {}
        self.clock = int(time.time())

    def probe(self, pair):
        self.calls.append(pair.base_url)
        status, verdict = self.script.get(pair.base_url, (200, "valid"))
        self.clock += 1
        return ProbeOutcome(credential_id=pair.hash(), base_url=pair.base_url,
                            probe_kind="models", http_status=status, verdict=verdict,
                            probed_at=self.clock)


class _RecordingAlerter:
    def __init__(self):
        self.messages = []

    def notify(self, message):
        self.messages.append(message)
        return True


def _components(cfg, adapter, prober, alerter):
    from classify.engine import RuleEngine
    from extract.credentials import LayeredExtractor
    from probe.verdict import StateMachine

    return {
        "adapter": adapter,
        "classifier": RuleEngine(cfg),
        # 07 §5.1 P0-5 探针消歧: the extractor owns the pipeline prober, exactly
        # as main.build_components wires it (multi-candidate low pairings are
        # resolved by single-shot GET /v1/models, not silently collapsed).
        "extractor": LayeredExtractor(cfg, prober=prober),
        "prober": prober,
        "machine": StateMachine(cfg),
        "feed": RssFeed(cfg),
        "reporter": DailyReport(cfg),
        "alerter": alerter,
    }


class WiringTestCase(unittest.TestCase):
    """Shared harness: one in-memory DB + temp publish dir per test."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-wiring-")
        self.cfg = _cfg(self.tmp)
        self.conn = db.connect_in_memory()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _run(self, adapter, prober, alerter):
        return main.run_cycle(self.cfg, conn=self.conn,
                              components=_components(self.cfg, adapter, prober, alerter))

    def _rows(self, sql, args=()):
        return list(self.conn.execute(sql, args))


class BPostFlowTests(WiringTestCase):
    def test_b_post_stored_probed_and_published(self):
        body = f"端点 {RELAY_URL} key {FAKE_KEY}"
        adapter = _FakeAdapter([_post(3001, body, title="中转分享")])
        prober = _ScriptedProber()
        alerter = _RecordingAlerter()

        result = self._run(adapter, prober, alerter)

        self.assertEqual(1, result.credentials)
        self.assertEqual(1, result.stored_keys)
        self.assertEqual({"high": 1}, result.stored_by_confidence)
        self.assertEqual([RELAY_URL], prober.calls)

        rows = self._rows("SELECT * FROM token_keys")
        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("valid", row["verdict"])
        self.assertEqual(RELAY_URL, row["base_url"])
        self.assertEqual(crypto.mask(FAKE_KEY), row["key_masked"])
        self.assertEqual(crypto.sha256_hex(FAKE_KEY), row["key_hash"])
        self.assertTrue(row["key_encrypted"].startswith("gAAAAA"))

        # probe_log joins the audit trail by the token_keys row id (seam fix).
        logs = self._rows("SELECT * FROM probe_log")
        self.assertEqual(1, len(logs))
        self.assertEqual(row["id"], logs[0]["credential_id"])
        self.assertEqual("valid", logs[0]["verdict"])

        # masked-level transition recorded for the report
        self.assertEqual(
            [("unknown", "valid")],
            [(c["from"], c["to"]) for c in result.verdict_changes],
        )

        # feed + report written, feed is well-formed RSS 2.0 with masked key
        self.assertTrue(os.path.isfile(self.cfg.feed_path))
        with open(self.cfg.feed_path, "r", encoding="utf-8") as fh:
            xml = fh.read()
        root = ET.fromstring(xml)
        self.assertEqual("2.0", root.get("version"))
        self.assertIn(crypto.mask(FAKE_KEY), xml)
        self.assertNotIn(FAKE_KEY, xml)
        reports = os.listdir(self.cfg.report_dir)
        self.assertEqual(1, len(reports))
        with open(os.path.join(self.cfg.report_dir, reports[0]), "r",
                  encoding="utf-8") as fh:
            report_text = fh.read()
        self.assertIn("keys_stored=1", report_text)
        self.assertNotIn(FAKE_KEY, report_text)

    def test_watermark_advances_and_second_round_rediscovers_nothing(self):
        body = f"端点 {RELAY_URL} key {FAKE_KEY}"
        adapter = _FakeAdapter([_post(3001, body)])
        prober = _ScriptedProber()
        alerter = _RecordingAlerter()

        first = self._run(adapter, prober, alerter)
        self.assertEqual(1, first.discovered)
        self.assertEqual(3001, first.watermark_after)

        second = self._run(adapter, prober, alerter)
        self.assertEqual(0, second.discovered)
        self.assertEqual([0, 3001], adapter.discover_since)
        self.assertEqual(3001, second.watermark_after)
        # the stock row is re-probed as existing state (07 §8.3 复探节奏)
        self.assertEqual(2, len(prober.calls))
        self.assertEqual(1, second.probe_outcomes)

    def test_missing_fernet_key_skips_store_never_plaintext(self):
        self.cfg = _cfg(self.tmp, fernet_key="")
        body = f"端点 {RELAY_URL} key {FAKE_KEY}"
        adapter = _FakeAdapter([_post(3001, body)])
        prober = _ScriptedProber()
        alerter = _RecordingAlerter()

        result = self._run(adapter, prober, alerter)

        self.assertEqual(0, result.stored_keys)
        self.assertEqual([], self._rows("SELECT * FROM token_keys"))
        self.assertTrue(any("skipped" in w for w in result.warnings))
        self.assertEqual(1, len(alerter.messages))  # the degradation alerted


class CGuideFlowTests(WiringTestCase):
    def test_c_post_stored_as_guide_without_any_key_data(self):
        body = "网盘链接在二楼，回复本主题后即可查看这部分内容。"
        adapter = _FakeAdapter([_post(23217, body, title="回复领取")],
                               rules=linux_sb_rules())
        prober = _ScriptedProber()
        result = self._run(adapter, prober, _RecordingAlerter())

        self.assertEqual(1, result.stored_guides)
        self.assertEqual(0, result.credentials)
        self.assertEqual([], prober.calls)  # C is never probed (D2)

        rows = self._rows("SELECT * FROM token_keys")
        self.assertEqual(1, len(rows))
        row = rows[0]
        self.assertEqual("reply_visible_guide", row["source"])
        self.assertEqual("", row["key_masked"])
        self.assertEqual("", row["base_url"])
        self.assertIsNone(row["key_encrypted"])
        self.assertNotEqual("", row["key_hash"])  # guide sentinel, no credential

        with open(self.cfg.feed_path, "r", encoding="utf-8") as fh:
            xml = fh.read()
        self.assertIn("回复本主题后即可查看", xml)
        self.assertNotIn("key:", xml)

    def test_guide_row_models_come_from_the_public_title_only(self):
        # The chips are what tells a reader whether replying is worth it; the
        # title is public, so this leaks nothing about the gated key (2026-10-09).
        body = "网盘链接在二楼，回复本主题后即可查看这部分内容。"
        adapter = _FakeAdapter([_post(23217, body, title="免费的grok4.6 速蹬")],
                               rules=linux_sb_rules())
        result = self._run(adapter, _ScriptedProber(), _RecordingAlerter())

        self.assertEqual(1, result.stored_guides)
        row = self._rows("SELECT * FROM token_keys")[0]
        self.assertEqual(["Grok 4.6"], json.loads(row["models"]))
        self.assertEqual("", row["key_masked"])  # still zero key data (D2)
        self.assertEqual("", row["base_url"])

    def test_guide_row_without_a_model_mention_stays_empty(self):
        body = "回复本主题后即可查看这部分内容。"
        adapter = _FakeAdapter([_post(23217, body, title="福利放送")],
                               rules=linux_sb_rules())
        self._run(adapter, _ScriptedProber(), _RecordingAlerter())
        row = self._rows("SELECT * FROM token_keys")[0]
        self.assertEqual("[]", row["models"])


class DRecordOnlyTests(WiringTestCase):
    def test_d_post_is_queued_but_never_extracted_nor_probed(self):
        card_body = ('<div class="virtual-card-price"><strong>88</strong>'
                     "<span>积分 / 张</span></div>")
        adapter = _FakeAdapter(
            [_post(24000, card_body, title="积分发卡", virtual_card=True)],
            rules=linux_sb_rules(),
        )
        prober = _ScriptedProber()
        result = self._run(adapter, prober, _RecordingAlerter())

        self.assertEqual({"D": 1}, result.categories)
        self.assertEqual(0, result.credentials)
        self.assertEqual(0, result.stored_keys)
        self.assertEqual([], prober.calls)  # 不提取不探测 (07 §8.1 D row)

        items = self._rows(
            "SELECT reason, detail FROM manual_queue WHERE status = 'pending'")
        self.assertEqual(1, len(items))
        self.assertEqual("card_or_paid_benefit_info", items[0]["reason"])
        self.assertIn("积分发卡", items[0]["detail"])
        self.assertIn("https://linux.sb/topic/24000", items[0]["detail"])
        self.assertIn("price=88 积分 / 张", items[0]["detail"])
        # record-only: nothing about a D post ever lands in token_keys
        self.assertEqual([], self._rows("SELECT * FROM token_keys"))


class ESuspectedTests(WiringTestCase):
    def test_suspected_valuable_e_goes_to_manual_queue(self):
        adapter = _FakeAdapter([_post(25000, "公益中转站，长期白嫖福利", title="白嫖")])
        result = self._run(adapter, _ScriptedProber(), _RecordingAlerter())

        self.assertEqual(1, result.categories.get(CATEGORY_E, 0))
        items = self._rows("SELECT reason FROM manual_queue WHERE status = 'pending'")
        self.assertEqual(["suspected_valuable_E"], [r["reason"] for r in items])
        self.assertEqual([], self._rows("SELECT * FROM token_keys"))


class TwoRoundDeadTests(WiringTestCase):
    """07 §5.4 ⑤: two consistent invalids 30s+ apart -> dead + out of the feed."""

    BASE = RELAY_URL

    def _cycle(self, prober, alerter):
        adapter = _FakeAdapter([_post(3001, f"端点 {self.BASE} key {FAKE_KEY}")])
        return self._run(adapter, prober, alerter)

    def test_first_invalid_only_marks_unknown_second_confirms_dead(self):
        prober = _ScriptedProber()
        prober.script = {self.BASE: (401, "invalid")}
        alerter = _RecordingAlerter()

        first = self._cycle(prober, alerter)
        row = self._rows("SELECT * FROM token_keys")[0]
        self.assertEqual("unknown", row["verdict"])          # 1st failure: undecided
        self.assertEqual(1, row["consecutive_failures"])
        logs = self._rows("SELECT * FROM probe_log WHERE credential_id = ?",
                          (row["id"],))
        self.assertEqual(1, len(logs))                        # 只记一次失败
        # still publishable while undecided
        self.assertEqual(1, len(db.select_publishable(self.conn)))
        with open(self.cfg.feed_path, "r", encoding="utf-8") as fh:
            self.assertIn(crypto.mask(FAKE_KEY), fh.read())

        # the 30s debounce window of 07 §8.3 must elapse between the rounds
        last_probed_at = logs[0]["probed_at"]
        prober.clock = last_probed_at + 31

        second = self._cycle(prober, alerter)
        row = self._rows("SELECT * FROM token_keys")[0]
        self.assertEqual("dead", row["verdict"])
        self.assertEqual(2, row["consecutive_failures"])
        logs = self._rows("SELECT * FROM probe_log WHERE credential_id = ?",
                          (row["id"],))
        self.assertEqual(2, len(logs))
        self.assertEqual([], db.select_publishable(self.conn))   # D3: out of feed
        with open(self.cfg.feed_path, "r", encoding="utf-8") as fh:
            xml = fh.read()
        self.assertNotIn(crypto.mask(FAKE_KEY), xml)
        self.assertEqual([("unknown", "dead")],
                         [(c["from"], c["to"]) for c in second.verdict_changes])

    def test_dead_row_reprobes_only_after_a_day(self):
        prober = _ScriptedProber()
        prober.script = {self.BASE: (401, "invalid")}
        alerter = _RecordingAlerter()
        self._cycle(prober, alerter)
        prober.clock += 31
        self._cycle(prober, alerter)
        self.assertEqual("dead", self._rows("SELECT verdict FROM token_keys")[0]["verdict"])

        prober.clock += 60  # minutes later: still inside the 24h recovery window
        third = self._cycle(prober, alerter)
        self.assertEqual(0, third.probe_outcomes)             # dead waits a day
        self.assertEqual(0, third.dead_due)                   # ...and is not due yet

        # once the day has passed (last_probe_at pushed back beyond 24h), the
        # daily recovery probe runs again (07 §8.3 / D3 挽回窗口)
        with self.conn:
            self.conn.execute("UPDATE token_keys SET last_probe_at = ?",
                              (db.now_ts() - 86401,))
        fourth = self._cycle(prober, alerter)
        self.assertEqual(1, fourth.probe_outcomes)
        # a dead row confirmed again stays dead (was_dead short-circuits the window)
        self.assertEqual("dead", self._rows("SELECT verdict FROM token_keys")[0]["verdict"])

    def test_unknown_five_rounds_escalates_to_manual_queue(self):
        prober = _ScriptedProber()
        prober.script = {self.BASE: (0, "unknown")}           # 000: never dead
        alerter = _RecordingAlerter()
        self._cycle(prober, alerter)
        for _ in range(4):
            prober.clock += 1
            self._cycle(prober, alerter)
        self.assertEqual("unknown",
                         self._rows("SELECT verdict FROM token_keys")[0]["verdict"])
        reasons = [r["reason"] for r in self._rows(
            "SELECT reason FROM manual_queue WHERE status = 'pending'")]
        self.assertIn("unknown_5_rounds", reasons)


class FallbackAlertTests(WiringTestCase):
    def test_sitemap_fallback_surfaces_and_alerts_once(self):
        adapter = _FakeAdapter([])
        adapter.warnings.append(
            "[warning] linux_sb aggregator unreachable (boom); "
            "fell back to https://linux.sb/sitemap.xml"
        )
        prober = _ScriptedProber()
        alerter = _RecordingAlerter()

        result = self._run(adapter, prober, alerter)

        self.assertTrue(result.aggregator_fallback)
        self.assertEqual(1, len(alerter.messages))
        self.assertIn("aggregator unreachable", alerter.messages[0])


if __name__ == "__main__":
    unittest.main()
