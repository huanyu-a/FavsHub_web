"""Regression tests for the eight confirmed review findings (integration).

One test group per finding, each failing on the pre-fix code:

1. ``build_components`` wires the prober into ``LayeredExtractor`` so the
   07 §8.2 probe disambiguation actually runs in the pipeline;
2. a ``confidence='low'`` pairing is stored + queued (P0-9) but withheld from
   the auto-published feed - the comment is enforced, not just claimed;
3. the D-class price comes from the topic HTML via ``FullPost
   .virtual_card_price`` (enrichment sniff), so "标题+链接+价格" is real;
4. one real 401 can never confirm dead: the prober's debounce copy keeps the
   original ``probed_at`` AND the fresh loop dedupes (key_hash, base_url);
5. a ``dead`` row stays dead on neutral re-probe evidence (07 §8.3 状态机图);
6. a 400 is an invalid candidate ONLY for the measured xAI/Google literals;
   every other 400 is unknown (07 §8.3 verbatim);
7. C-class guide rows keep the three key columns empty and coexist under the
   UNIQUE constraint via the credential-free sentinel, now recorded as a
   dated erratum in docs/07 §8.4;
8. every main() outbound line (JSON, summary, stderr warnings) is scrubbed.

Self-contained: fakes for the network edges, in-memory SQLite, tempfiles,
``sk-TESTFAKE`` keys only (the scrub test builds its hostile shape at runtime).
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crypto  # noqa: E402
import main  # noqa: E402
from config import AppConfig  # noqa: E402
from interfaces import (  # noqa: E402
    FullPost,
    ProbeOutcome,
    ProbeState,
    Prober,
    RawPost,
)
from probe import verdict  # noqa: E402
from probe.prober import HttpProber  # noqa: E402
from sources.linux_sb import LinuxSbAdapter  # noqa: E402
from store import db  # noqa: E402

FAKE_KEY = "sk-TESTFAKE0123456789abcdef"   # scanner-safe fake (07 §8.5)
URL_A = "https://relay-a.example.com/v1"
URL_B = "https://relay-b.example.com/v1"
PRICE_BOX = ('<div class="virtual-card-price"><strong>88</strong>'
             "<span>积分 / 张</span></div>")

#: Runtime-built credential shape WITHOUT the sk-TESTFAKE prefix, used only to
#: prove the scrub red line; never written to any file.
_HOSTILE_KEY = "sk-" + "Z" * 24


def _cfg(tmp: str) -> AppConfig:
    return AppConfig(
        agg_api_base="x", ua="x", forums=[2],
        db_path=os.path.join(tmp, "tokenhub.db"),
        dingtalk_webhook="", enable_paid_probe=False, enable_account_farm=False,
        fernet_key=crypto.generate_fernet_key().decode(),
    )


def _post(tid: int, body: str, title: str = "分享", **full_kwargs) -> FullPost:
    raw = RawPost(tid=tid, title=title, forum_id=2, forum_name="福利放送",
                  author_name="tester", url=f"https://linux.sb/topic/{tid}",
                  content_text=body)
    return FullPost(raw=raw, article_body=body, enriched=True, **full_kwargs)


class _FakeAdapter:
    source_id = "linux_sb"

    def __init__(self, fulls, rules=()):
        self._fulls = list(fulls)
        self._rules = list(rules)
        self.warnings = []
        self.pending_alerts = []

    def discover(self, since_tid):
        return [full.raw for full in self._fulls if full.raw.tid > since_tid]

    def enrich(self, post):
        for full in self._fulls:
            if full.raw.tid == post.tid:
                return full
        raise AssertionError(f"unexpected enrich tid={post.tid}")

    def classify_rules(self):
        return list(self._rules)


class _ScriptedProber(Prober):
    """Canned (http_status, verdict) per base_url; ``clock_step`` per call."""

    def __init__(self, clock_step: int = 1):
        self.calls = []
        self.script = {}
        self.clock = int(time.time())
        self.clock_step = clock_step

    def probe(self, pair):
        self.calls.append(pair.base_url)
        status, verdict_label = self.script.get(pair.base_url, (200, "valid"))
        self.clock += self.clock_step
        return ProbeOutcome(credential_id=pair.hash(), base_url=pair.base_url,
                            probe_kind="models", http_status=status,
                            verdict=verdict_label, probed_at=self.clock)


class _RecordingAlerter:
    def __init__(self):
        self.messages = []

    def notify(self, message):
        self.messages.append(message)
        return True


class _Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tokenhub-review-")
        self.cfg = _cfg(self.tmp)
        self.conn = db.connect_in_memory()
        db.init_db(self.conn)

    def tearDown(self):
        self.conn.close()

    def _run(self, adapter, prober, alerter):
        from classify.engine import RuleEngine
        from extract.credentials import LayeredExtractor
        from probe.verdict import StateMachine
        from publish.feed import RssFeed
        from publish.report import DailyReport

        return main.run_cycle(self.cfg, conn=self.conn, components={
            "adapter": adapter,
            "classifier": RuleEngine(self.cfg),
            "extractor": LayeredExtractor(self.cfg, prober=prober),
            "prober": prober,
            "machine": StateMachine(self.cfg),
            "feed": RssFeed(self.cfg),
            "reporter": DailyReport(self.cfg),
            "alerter": alerter,
        })

    def _feed_xml(self) -> str:
        with open(self.cfg.feed_path, "r", encoding="utf-8") as fh:
            return fh.read()

    def _mask(self) -> str:
        return crypto.mask(FAKE_KEY)


# ---------------------------------------------------------------------------
# Finding 1 - the pipeline's extractor owns the prober (07 §8.2 消歧)
# ---------------------------------------------------------------------------

class ExtractorDisambiguationWiringTests(_Harness):
    def test_build_components_hands_the_prober_to_the_extractor(self):
        parts = main.build_components(self.cfg)
        self.assertIs(parts["extractor"].prober, parts["prober"])

    def test_one_key_two_urls_is_disambiguated_to_medium_and_published(self):
        body = f"{URL_A} or {URL_B}\n{FAKE_KEY}"
        prober = _ScriptedProber()
        prober.script = {URL_A: (200, "valid"), URL_B: (200, "valid")}
        result = self._run(_FakeAdapter([_post(31001, body)]), prober,
                           _RecordingAlerter())

        # disambiguation probed candidates in order and the first non-401 won
        # ("取第一个非 401"): URL_A confirmed, so URL_B is never spent
        self.assertIn(URL_A, prober.calls)
        self.assertEqual({"medium": 1}, result.stored_by_confidence)
        row = self.conn.execute(
            "SELECT confidence, verdict, note FROM token_keys").fetchone()
        self.assertEqual("medium", row["confidence"])
        self.assertIn("probe-ok", row["note"])
        # a confirmed pairing is publishable - no low_confidence_pairing queue row
        self.assertIn(self._mask(), self._feed_xml())
        reasons = [r["reason"] for r in self.conn.execute(
            "SELECT reason FROM manual_queue WHERE status='pending'")]
        self.assertNotIn("low_confidence_pairing", reasons)


# ---------------------------------------------------------------------------
# Finding 2 - low pairings are stored + queued, never auto-published
# ---------------------------------------------------------------------------

class LowPairingNotPublishedTests(_Harness):
    def test_unconfirmed_low_pairing_is_queued_and_withheld_from_feed(self):
        body = f"{URL_A} or {URL_B}\n{FAKE_KEY}"
        prober = _ScriptedProber()
        prober.script = {URL_A: (401, "invalid"), URL_B: (401, "invalid")}
        self._run(_FakeAdapter([_post(31002, body)]), prober, _RecordingAlerter())

        row = self.conn.execute(
            "SELECT confidence, verdict FROM token_keys").fetchone()
        self.assertEqual("low", row["confidence"])          # stored, awaiting review
        reasons = [r["reason"] for r in self.conn.execute(
            "SELECT reason FROM manual_queue WHERE status='pending'")]
        self.assertIn("low_confidence_pairing", reasons)     # P0-9 filed
        self.assertNotIn(self._mask(), self._feed_xml())     # withheld from the feed

    def test_low_rows_do_not_reach_feed_entries(self):
        self.conn.execute(
            "INSERT INTO token_keys (id, source_id, source_tid, source_url, "
            "source_title, key_masked, key_hash, base_url, confidence, verdict, "
            "deal_status) VALUES ('x1','linux_sb',1,'u','t','sk-AAA*****bbbb',"
            "'h1','https://x/v1','low','unknown','published')")
        self.assertEqual([], main._feed_entries(self.conn))


# ---------------------------------------------------------------------------
# Finding 3 - D-class price from the topic HTML
# ---------------------------------------------------------------------------

class CardPricePlumbingTests(_Harness):
    def test_enrichment_sniffs_price_from_topic_html(self):
        html = ('<html><script type="application/ld+json">'
                '{"@type":"DiscussionForumPosting","articleBody":"发卡中"}</script>'
                f'<div class="virtual-card-box">{PRICE_BOX}</div></html>')

        def transport(url, headers, timeout):
            return 200, html

        adapter = LinuxSbAdapter("http://agg.example/api", "UA/1.0", (2,),
                                 transport=transport, sleeper=lambda s: None)
        raw = RawPost(tid=32001, title="发卡", forum_id=2, forum_name="x",
                      author_name="a", url="https://linux.sb/topic/32001",
                      content_text="发卡中")
        full = adapter.enrich(raw)
        self.assertTrue(full.virtual_card)
        self.assertEqual("88 积分 / 张", full.virtual_card_price)

    def test_degraded_enrichment_leaves_price_empty(self):
        def transport(url, headers, timeout):
            raise OSError("down")

        adapter = LinuxSbAdapter("http://agg.example/api", "UA/1.0", (2,),
                                 transport=transport, sleeper=lambda s: None)
        raw = RawPost(tid=32002, title="发卡", forum_id=2, forum_name="x",
                      author_name="a", url="https://linux.sb/topic/32002",
                      content_text="发卡中")
        full = adapter.enrich(raw)
        self.assertFalse(full.enriched)
        self.assertEqual("", full.virtual_card_price)

    def test_card_record_uses_the_sniffed_price_field(self):
        # body deliberately carries NO price markup: only the enrichment field can
        # supply the price, proving the plumbing (07 §8.1 D row 标题+链接+价格).
        from classify.rules_linux_sb import linux_sb_rules

        adapter = _FakeAdapter(
            [_post(32003, "发卡中，请自取", title="积分发卡",
                   virtual_card=True, virtual_card_price="88 积分 / 张")],
            rules=linux_sb_rules(),
        )
        prober = _ScriptedProber()
        result = self._run(adapter, prober, _RecordingAlerter())
        self.assertEqual({"D": 1}, result.categories)
        detail = self.conn.execute(
            "SELECT detail FROM manual_queue WHERE status='pending'").fetchone()["detail"]
        self.assertIn("price=88 积分 / 张", detail)
        self.assertEqual([], prober.calls)  # record-only: no extraction, no probe


# ---------------------------------------------------------------------------
# Finding 4 - one real 401 can never confirm dead
# ---------------------------------------------------------------------------

class SingleFailureNeverDeadTests(_Harness):
    def test_debounce_copy_keeps_the_original_probed_at(self):
        calls = []

        def transport(method, url, headers):
            calls.append(url)
            return 401, {}, '{"error":{"message":"Invalid Token"}}'

        clock = [1_000_000]
        cfg = _cfg(self.tmp)
        prober = HttpProber(cfg, transport=transport, now=lambda: clock[0])
        from interfaces import CredentialPair

        pair = CredentialPair(key=FAKE_KEY, base_url="https://api.openai.com/v1")
        first = prober.probe(pair)
        self.assertEqual(1, len(calls))               # one real request
        clock[0] = first.probed_at + 35               # still inside the 60s window
        second = prober.probe(pair)
        self.assertEqual(1, len(calls))               # served from the debounce cache
        self.assertEqual(first.probed_at, second.probed_at)  # SAME observation

        machine = verdict.StateMachine()
        decision = machine.next(
            ProbeState(verdict="unknown", consecutive_failures=1,
                       last_probe_at=first.probed_at),
            second,
        )
        self.assertNotEqual("dead", decision.verdict)  # one failure is never dead
        self.assertEqual("unknown", decision.verdict)

    def test_same_pair_in_two_posts_is_probed_once_and_stays_unknown(self):
        body = f"端点 {URL_A} key {FAKE_KEY}"
        prober = _ScriptedProber(clock_step=35)   # a second probe would clear 30s
        prober.script = {URL_A: (401, "invalid")}
        result = self._run(
            _FakeAdapter([_post(33001, body), _post(33002, body)]),
            prober, _RecordingAlerter())

        self.assertEqual(1, prober.calls.count(URL_A))    # ONE real observation
        self.assertEqual(1, result.stored_keys)
        row = self.conn.execute(
            "SELECT verdict, consecutive_failures FROM token_keys").fetchone()
        self.assertEqual("unknown", row["verdict"])
        self.assertEqual(1, row["consecutive_failures"])


# ---------------------------------------------------------------------------
# Finding 5 - dead rows never resurrect on neutral evidence
# ---------------------------------------------------------------------------

class DeadStaysDeadTests(_Harness):
    def test_state_machine_keeps_dead_on_neutral_and_garbage_labels(self):
        machine = verdict.StateMachine()
        dead = ProbeState(verdict="dead", consecutive_failures=2, last_probe_at=1000)
        for status, label in ((0, "unknown"), (503, "unknown"),
                              (403, "restricted"), (403, "blocked_by_waf"),
                              (404, "endpoint_unsupported")):
            outcome = ProbeOutcome(credential_id="c", base_url="u", probe_kind="models",
                                   http_status=status, verdict=label, probed_at=2000)
            self.assertEqual("dead", machine.next(dead, outcome).verdict, label)
        # the recovery arrow (07 §8.3) still works: demonstrated existence
        outcome = ProbeOutcome(credential_id="c", base_url="u", probe_kind="models",
                               http_status=200, verdict="valid", probed_at=2000)
        self.assertEqual("valid", machine.next(dead, outcome).verdict)
        # an invalid candidate re-confirms dead (counter keeps moving)
        outcome = ProbeOutcome(credential_id="c", base_url="u", probe_kind="models",
                               http_status=401, verdict="invalid", probed_at=2000)
        self.assertEqual("dead", machine.next(dead, outcome).verdict)

    def test_dead_row_reprobed_into_a_blackout_stays_dead_and_unpublished(self):
        prober = _ScriptedProber(clock_step=35)
        prober.script = {URL_A: (401, "invalid")}
        body = f"端点 {URL_A} key {FAKE_KEY}"
        self._run(_FakeAdapter([_post(34001, body)]), prober, _RecordingAlerter())
        prober.clock += 35
        self._run(_FakeAdapter([]), prober, _RecordingAlerter())     # -> dead
        self.assertEqual("dead",
                         self.conn.execute("SELECT verdict FROM token_keys").fetchone()["verdict"])

        # daily re-probe fires into a transport blackout: the row must NOT
        # resurrect into the feed snapshot (07 §8.3 / D3)
        with self.conn:
            self.conn.execute("UPDATE token_keys SET last_probe_at = ?",
                              (db.now_ts() - 86401,))
        prober.script = {URL_A: (0, "unknown")}
        prober.clock += 90_000
        self._run(_FakeAdapter([]), prober, _RecordingAlerter())
        self.assertEqual("dead",
                         self.conn.execute("SELECT verdict FROM token_keys").fetchone()["verdict"])
        self.assertEqual([], db.select_publishable(self.conn))
        self.assertNotIn(self._mask(), self._feed_xml())


# ---------------------------------------------------------------------------
# Finding 6 - 400 is an invalid candidate only for xAI/Google literals
# ---------------------------------------------------------------------------

class GoogleXai400Tests(unittest.TestCase):
    def test_only_measured_xai_google_literals_are_invalid(self):
        for body in ('{"error":{"status":"API_KEY_INVALID"}}',
                     '{"code":"invalid-argument"}',
                     '{"error":{"message":"API key not valid. Please pass a valid API key."}}'):
            self.assertEqual(verdict.RESPONSE_INVALID,
                             verdict.classify_response(400, "application/json", body), body)

    def test_every_other_400_is_unknown(self):
        bodies = (
            '{"error":"invalid_grant","error_description":"token expired"}',  # OAuth
            '{"error":{"message":"Invalid JSON payload received."}}',          # parse
            '{"error":{"message":"max_tokens must be > 0"}}',                  # request
            '{"message":"没有可用渠道"}',                                        # relay
        )
        for body in bodies:
            self.assertEqual("unknown",
                             verdict.classify_response(400, "application/json", body), body)

    def test_401_table_is_unchanged(self):
        self.assertEqual(verdict.RESPONSE_INVALID, verdict.classify_response(
            401, "application/json", '{"error":{"message":"Incorrect API key provided"}}'))
        self.assertEqual("unknown", verdict.classify_response(
            401, "application/json", '{"error":{"message":"未提供令牌"}}'))


# ---------------------------------------------------------------------------
# Finding 7 - guide sentinel documented + the three key columns stay empty
# ---------------------------------------------------------------------------

class GuideSentinelTests(_Harness):
    def test_guide_rows_keep_key_columns_empty_and_coexist(self):
        from classify.rules_linux_sb import linux_sb_rules

        fulls = [
            _post(35001, "回复本主题后即可查看", title="C1"),
            _post(35002, "[回复可见]内容", title="C2"),
        ]
        self._run(_FakeAdapter(fulls, rules=linux_sb_rules()),
                  _ScriptedProber(), _RecordingAlerter())
        rows = self.conn.execute(
            "SELECT source_tid, key_masked, key_hash, key_encrypted, base_url "
            "FROM token_keys ORDER BY source_tid").fetchall()
        self.assertEqual(2, len(rows))                    # UNIQUE holds for both
        for row in rows:
            self.assertEqual("", row["key_masked"])       # no masked value
            self.assertIsNone(row["key_encrypted"])       # no ciphertext
            self.assertEqual("", row["base_url"])         # no endpoint
            # the sentinel derives from (source_id, tid) only - no credential
            self.assertEqual(db.guide_key_hash("linux_sb", row["source_tid"]),
                             row["key_hash"])

    def test_07_section_84_erratum_is_recorded(self):
        doc_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                os.pardir, "docs", "07-最终执行方案.md")
        with open(doc_path, "r", encoding="utf-8") as fh:
            doc = fh.read()
        # the dated erratum must record the sentinel resolution and keep the
        # original "C 类留空" wording visible in the DDL line
        self.assertIn("勘误（2026-09-29", doc)
        self.assertIn('guide|', doc)
        self.assertIn("C 类留空（见 DDL 后「勘误 2026-09-29」）", doc)


# ---------------------------------------------------------------------------
# Finding 8 - every main() outbound line is scrubbed
# ---------------------------------------------------------------------------

class MainOutputScrubbedTests(unittest.TestCase):
    def _result_with_hostile_warning(self):
        result = main.CycleResult(dry_run=False)
        result.warnings.append(f"probe failed near {_HOSTILE_KEY} (URLError)")
        return result

    def test_summary_and_stderr_warnings_are_scrubbed(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            main._print_result(self._result_with_hostile_warning(), as_json=False)
        self.assertNotIn(_HOSTILE_KEY, out.getvalue())
        self.assertNotIn(_HOSTILE_KEY, err.getvalue())
        self.assertIn("***REDACTED***", err.getvalue())
        self.assertIn("discovered=0", out.getvalue())

    def test_json_output_is_scrubbed(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            main._print_result(self._result_with_hostile_warning(), as_json=True)
        payload = json.loads(out.getvalue())
        self.assertNotIn(_HOSTILE_KEY, out.getvalue())
        self.assertIn("***REDACTED***", payload["warnings"][0])


if __name__ == "__main__":
    unittest.main()
