"""Tests for :mod:`probe.verdict` - 07 §8.3's verdict table + state machine (P0-6).

Self-contained: no network, no real key (every credential here is a
``sk-TESTFAKE`` fabrication, 07 §8.5), no ``crawler/data/`` database. The
response-semantics rows are replayed straight from the skeleton fixture
``fixtures/probe_response_table.json``, whose bodies are quoted from 02 §B.1 /
§B.2 / §B.6.
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import interfaces  # noqa: E402
from fixtures import load  # noqa: E402
from probe import verdict  # noqa: E402

FAKE_KEY = "sk-TESTFAKE00000000000000000000000000000000000000000000"

TABLE = load("probe_response_table")


def outcome(label: str, status: int = 401, probed_at: int = 0, kind: str = "models"):
    """A :class:`interfaces.ProbeOutcome` for state-machine folds."""
    return interfaces.ProbeOutcome(
        credential_id="cid", base_url="https://api.example.com/v1", probe_kind=kind,
        http_status=status, verdict=label, probed_at=probed_at,
    )


class NormalizationTests(unittest.TestCase):
    """07 §8.2 / §8.3: two spellings of a base URL must dedupe to one target."""

    def test_trailing_slashes_and_case(self):
        self.assertEqual(verdict.normalize_base_url("https://API.OpenAI.com/v1//"),
                         "https://api.openai.com/v1")
        self.assertEqual(verdict.normalize_base_url("https://api.openai.com/v1"),
                         verdict.normalize_base_url("https://api.openai.com/v1/"))

    def test_scheme_is_added_and_query_dropped(self):
        # A shared post writes "api.deepseek.com/v1"; the ladder needs a scheme.
        self.assertEqual(verdict.normalize_base_url("api.deepseek.com/v1"),
                         "https://api.deepseek.com/v1")
        # Level 3's ``?key=`` must not make the same endpoint look different.
        self.assertEqual(verdict.normalize_base_url("https://api.gpt.ge/v1/models?key=x"),
                         "https://api.gpt.ge/v1/models")

    def test_empty_and_junk(self):
        for junk in ("", "   ", "://", "not a url"):
            self.assertEqual(verdict.normalize_base_url(junk), "", junk)

    def test_host_origin_and_endpoint_key(self):
        base = "https://api.groq.com/openai/v1"
        self.assertEqual(verdict.url_host(base), "api.groq.com")
        self.assertEqual(verdict.url_origin(base), "https://api.groq.com")
        self.assertEqual(verdict.endpoint_key(verdict.models_target_or_plain(base)
                                              if hasattr(verdict, "models_target_or_plain")
                                              else base + "/models"),
                         "api.groq.com/openai/v1/models")

    def test_is_public_endpoint_covers_the_three_measured_ones(self):
        for entry in verdict.OPEN_200_ENDPOINTS:
            self.assertTrue(verdict.is_public_endpoint("https://" + entry), entry)
        self.assertFalse(verdict.is_public_endpoint("https://api.openai.com/v1/models"))
        self.assertFalse(verdict.is_public_endpoint(""))


class BodyIndicatesTests(unittest.TestCase):
    def test_case_insensitive_and_order_preserving(self):
        body = '{"error":{"message":"Incorrect API key provided"}}'
        self.assertEqual(verdict.body_indicates(body, verdict.INVALID_KEY_HINTS),
                         "Incorrect API key")
        self.assertIsNone(verdict.body_indicates(body, verdict.QUOTA_HINTS))
        self.assertIsNone(verdict.body_indicates("", verdict.INVALID_KEY_HINTS))
        self.assertIsNone(verdict.body_indicates(None, verdict.INVALID_KEY_HINTS))

    def test_cjk_hints(self):
        self.assertEqual(
            verdict.body_indicates("您的 IP 不在令牌允许访问的列表中", verdict.RESTRICTED_HINTS),
            "您的 IP 不在令牌允许访问的列表中")

    def test_management_api_rejection_needs_the_json_flag(self):
        self.assertTrue(verdict.says_management_api_rejection('{"success": false}'))
        self.assertTrue(verdict.says_management_api_rejection('{"success":false}'))
        self.assertFalse(verdict.says_management_api_rejection('{"success":true}'))
        self.assertFalse(verdict.says_management_api_rejection("success"))


class VerdictTableFixtureTests(unittest.TestCase):
    """07 P0-6 acceptance: the table matches the 02 §B.1 measurements row by row."""

    def _check(self, row: dict) -> None:
        got = verdict.classify_request(
            row.get("endpoint", ""), int(row["http_status"]),
            row.get("content_type", "application/json"),
            row.get("body_fragment", ""), row.get("headers") or {},
        )
        self.assertEqual(got, row["expected_verdict"],
                         f"{row.get('endpoint') or row.get('case')}: {got}")

    def test_invalid_credential_rows(self):
        for row in TABLE["invalid_credential"]:
            self._check(row)

    def test_same_status_ambiguity_rows(self):
        for row in TABLE["same_status_ambiguity"]:
            self._check(row)

    def test_every_row_label_is_in_the_response_set(self):
        for row in list(TABLE["invalid_credential"]) + list(TABLE["same_status_ambiguity"]):
            self.assertIn(row["expected_verdict"], verdict.RESPONSE_VERDICTS)

    def test_public_200_is_the_one_rule_classify_response_cannot_see(self):
        """CONTRACT-ISSUE 2 evidence: the URL is required for the 2xx exception."""
        row = next(r for r in TABLE["invalid_credential"]
                   if r["endpoint"] == "openrouter.ai/api/v1/models")
        without_url = verdict.classify_response(int(row["http_status"]), "application/json",
                                                row["body_fragment"])
        with_url = verdict.classify_request(row["endpoint"], int(row["http_status"]),
                                           "application/json", row["body_fragment"])
        self.assertEqual(without_url, interfaces.VERDICT_VALID)
        self.assertEqual(with_url, interfaces.VERDICT_ENDPOINT_UNSUPPORTED)


class FiveAmbiguityGroupsTests(unittest.TestCase):
    """07 §8.3 "必须读 body 的 5 组同码歧义" - one discriminating pair each."""

    def test_group_1_401_invalid_vs_no_token_provided(self):
        # 02 §B.1: same relay, same 401, opposite meaning.
        invalid = verdict.classify_response(401, "application/json", "无效的令牌 (request id: x)")
        no_token = verdict.classify_response(401, "application/json", "未提供令牌 (request id: x)")
        self.assertEqual(invalid, verdict.RESPONSE_INVALID)
        self.assertEqual(no_token, interfaces.VERDICT_UNKNOWN)

    def test_group_2_403_five_meanings(self):
        cases = {
            interfaces.VERDICT_QUOTA: ("application/json",
                                       '{"code":"insufficient_user_quota",'
                                       '"message":"用户额度不足, 剩余额度: 0.1"}'),
            interfaces.VERDICT_RESTRICTED: ("application/json",
                                           "您的 IP 不在令牌允许访问的列表中"),
            interfaces.VERDICT_BLOCKED_BY_WAF: ("text/html; charset=utf-8",
                                                "<html><title>Just a moment...</title></html>"),
        }
        for want, (ctype, body) in cases.items():
            self.assertEqual(verdict.classify_response(403, ctype, body), want)
        # Group / region wording is a restriction, never an invalidation.
        self.assertEqual(verdict.classify_response(403, "application/json", "无权访问 vip 分组"),
                         interfaces.VERDICT_RESTRICTED)
        self.assertEqual(verdict.classify_response(403, "application/json",
                                                   "request from this region is not allowed"),
                         interfaces.VERDICT_RESTRICTED)
        # And an unexplained 403 is undecided, never invalid (07 铁律).
        self.assertEqual(verdict.classify_response(403, "application/json", "Forbidden"),
                         interfaces.VERDICT_UNKNOWN)

    def test_group_3_429_limited_vs_quota(self):
        self.assertEqual(verdict.classify_response(429, "application/json",
                                                   "Too Many Requests"),
                         interfaces.VERDICT_LIMITED)
        self.assertEqual(verdict.classify_response(429, "application/json",
                                                   '{"error":{"code":"credit_balance_'
                                                   'exhausted"}}'),
                         interfaces.VERDICT_QUOTA)

    def test_group_4_404_path_vs_unimplemented(self):
        # Both meanings say nothing about the credential (07: "不判失效").
        for body in ("404 page not found", '{"error":{"message":"not found"}}'):
            self.assertEqual(verdict.classify_response(404, "text/plain", body),
                             interfaces.VERDICT_ENDPOINT_UNSUPPORTED)
        self.assertEqual(verdict.classify_response(405, "text/html", "Method Not Allowed"),
                         interfaces.VERDICT_ENDPOINT_UNSUPPORTED)

    def test_group_5_200_success_vs_management_api(self):
        self.assertEqual(verdict.classify_response(200, "application/json",
                                                   '{"data":[{"id":"gpt-4o"}]}'),
                         interfaces.VERDICT_VALID)
        self.assertEqual(verdict.classify_response(200, "application/json",
                                                   '{"message":"无权进行此操作，access token 无效",'
                                                   '"success":false}'),
                         interfaces.VERDICT_UNKNOWN)


class IronRuleTests(unittest.TestCase):
    """07 §8.3 降误报铁律, verbatim."""

    def test_000_timeout_and_5xx_are_unknown_never_dead(self):
        for status in (0, 500, 502, 503, 504, 408):
            label = verdict.classify_response(status, "text/html", "gateway blew up")
            self.assertEqual(label, interfaces.VERDICT_UNKNOWN, status)

    def test_403_never_becomes_invalid_under_any_body(self):
        bodies = ("", "{}", "Just a moment...", "Forbidden", "用户额度不足", "分组", "region",
                  '{"error":{"message":"Incorrect API key provided"}}',
                  "404 page not found", "<html>Invalid Authentication</html>")
        for body in bodies:
            label = verdict.classify_response(403, "text/html", body)
            self.assertNotEqual(label, verdict.RESPONSE_INVALID, body)
            self.assertNotEqual(label, interfaces.VERDICT_DEAD, body)
            self.assertIn(label, verdict.RESPONSE_VERDICTS)

    def test_xai_and_google_400_shapes(self):
        google = ('{"error":{"code":400,"message":"API key not valid…",'
                  '"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}')
        xai = '{"code":"invalid-argument","error":"Incorrect API key provided…"}'
        self.assertEqual(verdict.classify_response(400, "application/json", google),
                         verdict.RESPONSE_INVALID)
        self.assertEqual(verdict.classify_response(400, "application/json", xai),
                         verdict.RESPONSE_INVALID)
        # "其他 → unknown": an unrelated 400 must not condemn a live key.
        self.assertEqual(verdict.classify_response(400, "application/json",
                                                   '{"error":"max_tokens must be > 0"}'),
                         interfaces.VERDICT_UNKNOWN)

    def test_relay_error_type_literals_are_never_consulted(self):
        """07 §8.3: ``error.type`` had 5 different values across 6 relays (02 §B.1)."""
        # The table and the fixture are two spellings of one measured fact; pin
        # them together so a future 02 evidence update cannot drift past a green
        # suite by only editing one of the two.
        self.assertEqual(list(verdict.UNTRUSTED_ERROR_TYPE_LITERALS),
                         list(TABLE["relay_error_type_literals_observed"]))
        for literal in verdict.UNTRUSTED_ERROR_TYPE_LITERALS:
            body = '{"error":{"type":"%s","message":"无效的令牌"}}' % literal
            self.assertEqual(verdict.classify_response(401, "application/json", body),
                             verdict.RESPONSE_INVALID, literal)
            no_token = '{"error":{"type":"%s","message":"未提供令牌"}}' % literal
            self.assertEqual(verdict.classify_response(401, "application/json", no_token),
                             interfaces.VERDICT_UNKNOWN, literal)

    def test_measured_401_endpoints_from_02_b1(self):
        # A sample of the vendor table, beyond what the fixture quotes.
        rows = [
            ("api.siliconflow.cn", '{"code":30014,"message":"Token is invalid."}'),
            ("api.moonshot.cn", '{"error":{"message":"Invalid Authentication"}}'),
            ("open.bigmodel.cn", '{"error":{"code":"401","message":"令牌已过期或验证不正确"}}'),
            ("api.cerebras.ai", '{"message":"Wrong API Key","code":"wrong_api_key"}'),
            ("api.fireworks.ai", '{"error":{"message":"The API key you provided is invalid.",'
                                 '"code":"UNAUTHORIZED"}}'),
            ("api.chatanywhere.tech", '{"error":{"type":"chatanywhere_error",'
                                      '"message":"ApiKey错误"}}'),
            ("api.gptgod.online", '{"error":{"code":"invalid_api_key",'
                                  '"message":"Invalid API key"}}'),
            ("api.chatfire.cn", '{"error":{"message":"Authentication Fails, Your api key: '
                                '****0000 is invalid"}}'),
        ]
        for host, body in rows:
            self.assertEqual(verdict.classify_response(401, "application/json", body),
                             verdict.RESPONSE_INVALID, host)

    def test_307_and_402_are_not_the_verdict(self):
        # 02 §B.1: a trailing slash answers 307, which is not a credential verdict.
        self.assertEqual(verdict.classify_response(307, "", ""), interfaces.VERDICT_UNKNOWN)
        # 07 §8.3: 额度耗尽 is NOT 402, so nothing may invent a 402 rule.
        self.assertEqual(verdict.classify_response(402, "application/json", "pay up"),
                         interfaces.VERDICT_UNKNOWN)

    def test_quotas_never_become_dead(self):
        for body in ('{"code":"insufficient_user_quota"}',
                     "credit_balance_exhausted",
                     "organization_spend_limit_exceeded",
                     "用户额度不足, 剩余额度: 0"):
            for status in (403, 429):
                self.assertIn(verdict.classify_response(status, "application/json", body),
                              (interfaces.VERDICT_QUOTA,), (status, body))


class StateMachineTests(unittest.TestCase):
    """07 §8.3's state machine, including the 30 s / two-round dead gate."""

    def setUp(self):
        self.machine = verdict.StateMachine()

    def test_thresholds_come_from_interfaces_not_local_numbers(self):
        self.assertEqual(self.machine.dead_consecutive_invalid,
                         interfaces.DEAD_CONSECUTIVE_INVALID)
        self.assertEqual(self.machine.dead_confirm_min_interval_s,
                         interfaces.DEAD_CONFIRM_MIN_INTERVAL_S)
        self.assertEqual(self.machine.unknown_rounds_to_manual,
                         interfaces.UNKNOWN_ROUNDS_TO_MANUAL)
        self.assertEqual(self.machine.dead_reprobe_interval_s,
                         interfaces.DEAD_REPROBE_INTERVAL_S)

    def test_single_invalid_candidate_is_never_dead(self):
        decision = self.machine.next(interfaces.ProbeState(), outcome(
            verdict.RESPONSE_INVALID, probed_at=1_000))
        self.assertEqual(decision.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertEqual(decision.consecutive_failures, 1)
        self.assertFalse(decision.escalate)

    def test_two_consistent_invalids_30s_apart_are_dead(self):
        first = self.machine.next(interfaces.ProbeState(), outcome(
            verdict.RESPONSE_INVALID, probed_at=1_000))
        second = self.machine.next(
            interfaces.ProbeState(verdict=first.verdict,
                                  consecutive_failures=first.consecutive_failures,
                                  last_probe_at=1_000),
            outcome(verdict.RESPONSE_INVALID, probed_at=1_030))
        self.assertEqual(second.verdict, interfaces.VERDICT_DEAD)

    def test_two_invalids_inside_the_window_confirm_nothing(self):
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_UNKNOWN,
                                        consecutive_failures=1, last_probe_at=1_000)
        decision = self.machine.next(previous, outcome(verdict.RESPONSE_INVALID, probed_at=1_029))
        self.assertEqual(decision.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertEqual(decision.consecutive_failures, 2)

    def test_transport_failure_does_not_advance_or_reset_the_counter(self):
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_UNKNOWN,
                                        consecutive_failures=1, last_probe_at=1_000)
        decision = self.machine.next(previous, outcome(interfaces.VERDICT_UNKNOWN,
                                                       status=0, probed_at=1_010))
        self.assertEqual(decision.consecutive_failures, 1)
        self.assertEqual(decision.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertEqual(decision.unknown_rounds, 1)

    def test_000_403_429_injections_cannot_reach_dead(self):
        """07 §5.1 P0-6 acceptance, run through three full rounds."""
        state = interfaces.ProbeState()
        for label, status in ((interfaces.VERDICT_UNKNOWN, 0),
                              (interfaces.VERDICT_BLOCKED_BY_WAF, 403),
                              (interfaces.VERDICT_LIMITED, 429),
                              (interfaces.VERDICT_QUOTA, 403),
                              (interfaces.VERDICT_RESTRICTED, 403),
                              (interfaces.VERDICT_ENDPOINT_UNSUPPORTED, 404)):
            current = outcome(label, status=status, probed_at=10_000)
            decision = self.machine.next(state, current)
            self.assertNotEqual(decision.verdict, interfaces.VERDICT_DEAD, label)
            # Exactly how main.run_cycle feeds it back: the decision plus the
            # probe's own timestamp (store.db.update_verdict writes last_probe_at).
            state = interfaces.ProbeState(verdict=decision.verdict,
                                          consecutive_failures=decision.consecutive_failures,
                                          last_probe_at=current.probed_at,
                                          unknown_rounds=decision.unknown_rounds)
        self.assertNotEqual(state.verdict, interfaces.VERDICT_DEAD)

    def test_valid_recovers_a_dead_row_and_resets_the_counter(self):
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_DEAD,
                                        consecutive_failures=2, last_probe_at=1_000)
        decision = self.machine.next(previous, outcome(interfaces.VERDICT_VALID,
                                                      status=200, probed_at=90_000))
        self.assertEqual(decision.verdict, interfaces.VERDICT_VALID)
        self.assertEqual(decision.consecutive_failures, 0)
        self.assertEqual(decision.unknown_rounds, 0)

    def test_quota_and_limited_also_prove_the_credential(self):
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_DEAD,
                                        consecutive_failures=2, last_probe_at=1_000)
        for label, status in ((interfaces.VERDICT_QUOTA, 429),
                              (interfaces.VERDICT_LIMITED, 429)):
            decision = self.machine.next(previous, outcome(label, status=status,
                                                           probed_at=90_000))
            self.assertEqual(decision.consecutive_failures, 0)
            self.assertEqual(decision.verdict, label)

    def test_dead_row_keeps_confirming_and_never_escalates(self):
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_DEAD,
                                        consecutive_failures=2, last_probe_at=1_000)
        decision = self.machine.next(previous, outcome(verdict.RESPONSE_INVALID, probed_at=1_001))
        self.assertEqual(decision.verdict, interfaces.VERDICT_DEAD)
        self.assertEqual(decision.consecutive_failures, 3)

    def test_unknown_five_rounds_escalates_once(self):
        state = interfaces.ProbeState()
        for round_index in range(1, interfaces.UNKNOWN_ROUNDS_TO_MANUAL):
            decision = self.machine.next(state, outcome(interfaces.VERDICT_UNKNOWN,
                                                        status=0, probed_at=1_000 * round_index))
            self.assertFalse(decision.escalate, round_index)
            state = interfaces.ProbeState(verdict=decision.verdict,
                                         consecutive_failures=decision.consecutive_failures,
                                         last_probe_at=1_000 * round_index,
                                         unknown_rounds=decision.unknown_rounds)
        fifth = self.machine.next(state, outcome(interfaces.VERDICT_UNKNOWN, status=0,
                                                 probed_at=99_000))
        self.assertEqual(fifth.unknown_rounds, interfaces.UNKNOWN_ROUNDS_TO_MANUAL)
        self.assertTrue(fifth.escalate)

    def test_undecided_never_escalates_and_breaks_the_streak(self):
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_UNKNOWN,
                                        consecutive_failures=0, last_probe_at=1_000,
                                        unknown_rounds=4)
        decision = self.machine.next(previous, outcome(interfaces.VERDICT_RESTRICTED,
                                                      status=403, probed_at=2_000))
        self.assertFalse(decision.escalate)
        self.assertEqual(decision.unknown_rounds, 0)
        self.assertEqual(decision.verdict, interfaces.VERDICT_RESTRICTED)

    def test_output_verdict_is_always_a_persistable_enum_value(self):
        labels = list(verdict.RESPONSE_VERDICTS) + ["quantum", "", "DEAD"]
        for label in labels:
            for state in (interfaces.ProbeState(),
                          interfaces.ProbeState(verdict=interfaces.VERDICT_DEAD,
                                               consecutive_failures=5, last_probe_at=1_000)):
                decision = self.machine.next(state, outcome(label, probed_at=5_000))
                self.assertTrue(verdict.is_persistable(decision.verdict), (label, decision))

    def test_missing_probed_at_cannot_be_read_as_no_interval(self):
        # 07 §8.3's 30 s window is measured on the prober's clock, not on a default.
        previous = interfaces.ProbeState(verdict=interfaces.VERDICT_UNKNOWN,
                                        consecutive_failures=1, last_probe_at=1_000)
        decision = self.machine.next(previous, outcome(verdict.RESPONSE_INVALID, probed_at=0))
        self.assertEqual(decision.verdict, interfaces.VERDICT_UNKNOWN)

    def test_is_due_reprobe_gate(self):
        dead = interfaces.ProbeState(verdict=interfaces.VERDICT_DEAD,
                                    consecutive_failures=2, last_probe_at=1_000)
        self.assertFalse(self.machine.is_due_reprobe(dead, 1_000 + 3_600))
        self.assertTrue(self.machine.is_due_reprobe(dead, 1_000 + interfaces.DEAD_REPROBE_INTERVAL_S))
        self.assertTrue(self.machine.is_due_reprobe(
            interfaces.ProbeState(verdict=interfaces.VERDICT_DEAD), 10_000))
        # Anything not dead rides the 3-hourly cron (07 §8.3 复探节奏).
        self.assertTrue(self.machine.is_due_reprobe(
            interfaces.ProbeState(verdict=interfaces.VERDICT_VALID, last_probe_at=9_999), 10_000))


if __name__ == "__main__":
    unittest.main()
