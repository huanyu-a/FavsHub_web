"""Tests for :mod:`probe.prober` - 07 §8.3's ladder, concurrency and backoff (P0-6).

Offline by construction: every request goes through an injected transport
(07 §5.2 ``transport`` contract, ``fetch(method, url, headers[, body]) ->
(status, headers, first 4 KB)``) except one localhost HTTP server that exists
only to prove the 4 KB read cap, and one opt-in real-endpoint smoke that is
skipped unless ``PROBE_SMOKE=1`` (ARCHITECTURE §2.3: the suite must never touch
the network by default). No real credential: the key is a ``sk-TESTFAKE``
fabrication (07 §8.5).
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import interfaces  # noqa: E402
from config import load_config  # noqa: E402  (the live smoke uses the real UA)
from probe import prober, verdict  # noqa: E402

FAKE_KEY = "sk-TESTFAKE00000000000000000000000000000000000000000000"

JSON_HEADERS = {"content-type": "application/json"}
HTML_HEADERS = {"content-type": "text/html; charset=UTF-8"}

OPENAI_INVALID = ('{"error":{"message":"Incorrect API key provided: sk-thisi***'
                  '...0000.","type":"invalid_request_error","code":"invalid_api_key"}}')
XAI_INVALID = '{"code":"invalid-argument","error":"Incorrect API key provided."}'
NO_TOKEN = '{"error":{"message":"未提供令牌 (request id: abc)","type":"new_api_error"}}'
RELAY_OK = '{"data":[{"id":"gpt-4o"}]}'


class Cfg:
    """The two config fields the prober reads (07 §8.3 / §5.2 ``.env.example``)."""

    def __init__(self, ua="probe-test-ua", enable_paid_probe=False):
        self.ua = ua
        self.enable_paid_probe = enable_paid_probe


class ScriptedTransport:
    """A transport double: answers from a URL-substring table, records every call."""

    def __init__(self, table, default=(200, JSON_HEADERS, RELAY_OK)):
        #: ordered list of (substring, response) pairs - first match wins.
        self.table = list(table)
        self.default = default
        self.calls = []          # [(method, url, headers, body)]
        self.hosts = []          # host per call, for order assertions
        self.inflight = 0
        self.max_inflight = 0
        self.host_inflight = {}
        self.max_host_inflight = {}
        self._lock = threading.Lock()
        self.hold_s = 0.0

    def __call__(self, method, url, headers, body=None):
        with self._lock:
            self.calls.append((method, url, dict(headers), body))
            host = verdict.url_host(url)
            self.hosts.append(host)
            self.inflight += 1
            self.max_inflight = max(self.max_inflight, self.inflight)
            self.host_inflight[host] = self.host_inflight.get(host, 0) + 1
            self.max_host_inflight[host] = max(self.max_host_inflight.get(host, 0),
                                               self.host_inflight[host])
        if self.hold_s:
            threading.Event().wait(self.hold_s)
        try:
            for substring, response in self.table:
                if substring in url:
                    # A callable lets one rule answer differently per attempt, so
                    # the tests can script "Bearer says no-token, x-api-key says
                    # invalid" on one URL.
                    if callable(response):
                        return response(method, url, headers, body)
                    return response
            return self.default if not callable(self.default) else self.default(
                method, url, headers, body)
        finally:
            with self._lock:
                self.inflight -= 1
                self.host_inflight[verdict.url_host(url)] -= 1

    # -- assertions helpers -------------------------------------------------
    def urls(self):
        return [call[1] for call in self.calls]

    def methods(self):
        return [call[0] for call in self.calls]

    def headers_for(self, substring):
        for _method, url, headers, _body in self.calls:
            if substring in url:
                return headers
        return None

    def count(self, substring):
        return sum(1 for url in self.urls() if substring in url)


def build(table, cfg=None, gate=None, sleeper=None, now_value=10_000):
    """An :class:`HttpProber` on a scripted transport with a fixed clock."""
    transport = ScriptedTransport(table)
    clock = [int(now_value)]
    prober_obj = prober.HttpProber(
        cfg=cfg or Cfg(),
        transport=transport,
        gate=gate or prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.0),
        sleeper=sleeper or (lambda seconds: None),
        now=lambda: clock[0],
    )
    prober_obj.clock = clock  # tests advance time through it
    return prober_obj, transport


def pair(key=FAKE_KEY, base_url="https://api.openai.com/v1", models=(), provider="openai"):
    return interfaces.CredentialPair(key=key, base_url=base_url, provider=provider,
                                     models=models, confidence="high")


class Level0PrecheckTests(unittest.TestCase):
    """07 §8.3 level 0: relay ``GET {origin}/api/status``."""

    def test_relay_gets_the_precheck_first(self):
        target, transport = build([("/api/status", (200, JSON_HEADERS, '{"success":true}')),
                                   ("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        outcome = target.probe(pair(base_url="https://api.gpt.ge/v1"))
        self.assertEqual(transport.hosts[0], "api.gpt.ge")
        self.assertIn("/api/status", transport.urls()[0])
        self.assertEqual(outcome.probe_kind, "models")
        self.assertEqual(outcome.verdict, verdict.RESPONSE_INVALID)

    def test_first_party_vendor_skips_the_precheck(self):
        # /api/status is a New API / one-api feature (02 §B.3); burning a request on
        # a vendor 404 would be pure waste (07 §8.3 "成本优先").
        target, transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        target.probe(pair(base_url="https://api.openai.com/v1"))
        self.assertEqual(transport.count("/api/status"), 0)

    def test_5xx_precheck_marks_the_host_unknown_and_stops(self):
        target, transport = build([("/api/status", (503, JSON_HEADERS, "upstream 502"))])
        outcome = target.probe(pair(base_url="https://api.gpt.ge/v1"))
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertEqual(outcome.probe_kind, "api_status")
        self.assertEqual(outcome.http_status, 503)
        self.assertEqual(transport.count("/v1/models"), 0,
                         "a dead relay must not be asked for the credential (07 §8.3)")

    def test_a_403_precheck_does_not_stop_the_ladder(self):
        # 02 §B.6 measured /api/status 403 (CF) while /v1/models answered 401 fine.
        target, transport = build([("/api/status", (403, HTML_HEADERS, "Just a moment...")),
                                   ("/v1/models", (401, JSON_HEADERS, NO_TOKEN))])
        outcome = target.probe(pair(base_url="https://api.gpt.ge/v1"))
        self.assertTrue(transport.count("/v1/models") >= 1)
        self.assertNotEqual(outcome.probe_kind, "api_status")

    def test_looks_like_relay_matches_the_measured_lists(self):
        self.assertTrue(prober.looks_like_relay("https://api.gpt.ge/v1"))
        self.assertTrue(prober.looks_like_relay("https://api.chatfire.cn/v1"))
        self.assertFalse(prober.looks_like_relay("https://api.openai.com/v1"))
        self.assertFalse(prober.looks_like_relay("https://openrouter.ai/api/v1"))


class Level1NativeTests(unittest.TestCase):
    """07 §8.3 level 1: OpenRouter is validated by ``GET /api/v1/key``, never ``/v1/models``."""

    def test_openrouter_uses_the_native_endpoint(self):
        target, transport = build([
            ("/api/v1/key", (401, JSON_HEADERS, '{"error":{"message":"User not found.","code":401}}')),
            ("/api/v1/models", (200, JSON_HEADERS, "x" * 751_207)),
        ])
        outcome = target.probe(pair(key="sk-TESTFAKE-or-v1-0123456789abcdef",
                                   base_url="https://openrouter.ai/api/v1"))
        self.assertEqual(outcome.probe_kind, "native")
        self.assertEqual(outcome.verdict, verdict.RESPONSE_INVALID)
        self.assertIn("openrouter.ai/api/v1/key", transport.urls()[0])

    def test_public_models_200_is_never_valid(self):
        # 02 §B.1: that endpoint answers 200 to an anonymous request (751 KB,
        # CF-Cache HIT), so a 200 there proves nothing about the credential.
        for base, models_path in (
            ("https://openrouter.ai/api/v1", "/api/v1/models"),
            ("https://api.novita.ai/v3/openai", "/v3/openai/models"),
            ("https://api.aihubmix.com/v1", "/v1/models"),
        ):
            target, _transport = build([
                ("/api/v1/key", (404, JSON_HEADERS, "not found")),
                (models_path, (200, JSON_HEADERS, '{"data":["public list"]}')),
            ])
            outcome = target.probe(pair(base_url=base))
            self.assertNotEqual(outcome.verdict, interfaces.VERDICT_VALID, base)
            self.assertEqual(outcome.verdict, interfaces.VERDICT_ENDPOINT_UNSUPPORTED, base)


class Level2BearerTests(unittest.TestCase):
    """07 §8.3 level 2: ``GET {base}/models`` + ``Authorization: Bearer``."""

    def test_bearer_and_ua_are_sent_and_the_verdict_is_the_measured_one(self):
        target, transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        outcome = target.probe(pair())
        headers = transport.headers_for("/v1/models")
        self.assertEqual(headers.get("Authorization"), f"Bearer {FAKE_KEY}")
        self.assertEqual(headers.get("User-Agent"), "probe-test-ua")  # 02 §B.7 step 3
        self.assertEqual(outcome.verdict, verdict.RESPONSE_INVALID)
        self.assertEqual(outcome.http_status, 401)
        self.assertEqual(outcome.probe_kind, "models")

    def test_vendor_path_is_appended_not_replaced(self):
        for base, want in (
            ("https://api.groq.com/openai/v1", "https://api.groq.com/openai/v1/models"),
            ("https://api.x.ai/v1/", "https://api.x.ai/v1/models"),
            ("api.moonshot.cn/v1", "https://api.moonshot.cn/v1/models"),
        ):
            self.assertEqual(prober.models_url(base), want)

    def test_xai_400_shape_is_the_invalid_candidate(self):
        target, _transport = build([("/v1/models", (400, JSON_HEADERS, XAI_INVALID))])
        outcome = target.probe(pair(base_url="https://api.x.ai/v1"))
        self.assertEqual(outcome.verdict, verdict.RESPONSE_INVALID)  # 07 §8.3: xAI is 400

    def test_valid_200_ends_the_ladder(self):
        target, transport = build([("/v1/models", (200, JSON_HEADERS, RELAY_OK))])
        outcome = target.probe(pair())
        self.assertEqual(outcome.verdict, interfaces.VERDICT_VALID)
        self.assertEqual(len(transport.calls), 1)

    def test_google_probes_v1beta_when_the_openai_path_404s(self):
        # 02 §B.1 measured Google on /v1beta/models; §B.6 says try it before giving up.
        target, transport = build([
            ("/v1/models", (404, JSON_HEADERS, "404 page not found")),
            ("/v1beta/models", (400, JSON_HEADERS,
                                '{"error":{"code":400,"message":"API key not valid."}}')),
        ])
        outcome = target.probe(pair(base_url="https://generativelanguage.googleapis.com/v1"))
        self.assertTrue(any("generativelanguage.googleapis.com/v1beta/models" in url
                            for url in transport.urls()), transport.urls())
        self.assertEqual(outcome.verdict, verdict.RESPONSE_INVALID)


class Level3AuthSchemesTests(unittest.TestCase):
    """07 §8.3 level 3: ``x-api-key`` / ``x-goog-api-key`` / ``?key=`` in that order."""

    def test_no_token_401_retries_every_scheme_in_order(self):
        target, transport = build([
            ("/api/status", (200, JSON_HEADERS, '{"success":true}')),
            ("/v1/models", (401, JSON_HEADERS, NO_TOKEN)),
        ])
        outcome = target.probe(pair(key="sk-TESTFAKE00000000000000000000000000000000",
                                   base_url="https://api.gpt.ge/v1"))
        kinds = [url for url in transport.urls()]
        self.assertEqual(transport.count("/v1/models"), 4,
                         "Bearer + x-api-key + x-goog-api-key + ?key= (07 §8.3)")
        by_header = {name: [h for _m, _u, h, _b in transport.calls if name in h]
                     for name in ("x-api-key", "x-goog-api-key")}
        self.assertEqual(len(by_header["x-api-key"]), 1, "each scheme exactly once")
        self.assertEqual(len(by_header["x-goog-api-key"]), 1)
        # A scheme *replaces* the Bearer header, it does not stack on it: a stale
        # Authorization is what makes relays answer "未提供令牌" (02 §B.6).
        for headers in by_header.values():
            self.assertNotIn("Authorization", headers[0])
        query_calls = [h for _m, url, h, _b in transport.calls if "key=" in url]
        self.assertEqual(len(query_calls), 1)
        self.assertNotIn("x-api-key", query_calls[0])
        self.assertNotIn("Authorization", query_calls[0])
        self.assertTrue(any("key=sk-TESTFAKE" in url for url in kinds), kinds)
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertEqual(outcome.probe_kind, "auth_retry:query_key")

    def test_a_scheme_that_works_ends_the_ladder(self):
        target, transport = build([
            ("/api/status", (200, JSON_HEADERS, '{"success":true}')),
            ("key=sk-TESTFAKE", (200, JSON_HEADERS, RELAY_OK)),
            ("/v1/models", (401, JSON_HEADERS, NO_TOKEN)),
        ])
        outcome = target.probe(pair(key="sk-TESTFAKE00000000000000000000000000000000",
                                   base_url="https://api.gpt.ge/v1"))
        self.assertEqual(outcome.verdict, interfaces.VERDICT_VALID)
        self.assertEqual(outcome.probe_kind, "auth_retry:query_key")
        self.assertEqual(transport.count("/v1/models"), 4)

    def test_query_key_url_encodes_the_credential(self):
        target, transport = build([("/v1/models", (401, JSON_HEADERS, NO_TOKEN))])
        target.probe(pair(key="sk-TESTFAKE abc/def", base_url="https://api.gpt.ge/v1"))
        query_urls = [url for url in transport.urls() if "key=" in url]
        self.assertTrue(query_urls)
        self.assertNotIn(" ", query_urls[-1], "a raw space would break the request line")

    def test_anthropic_gets_its_version_header(self):
        # A Bearer call is what the ladder tries first; the x-api-key rung must
        # additionally carry anthropic-version (02 §B.5 - without it, Anthropic
        # answers a 400 that has nothing to do with the key).
        def answer(method, url, headers, body):
            if "x-api-key" in headers:
                return (401, JSON_HEADERS, '{"error":{"message":"invalid x-api-key"}}')
            return (401, JSON_HEADERS, NO_TOKEN)

        target, transport = build([("/v1/models", answer)])
        outcome = target.probe(pair(key="sk-TESTFAKE-ant-api03-x",
                                   base_url="https://api.anthropic.com/v1"))
        self.assertEqual(outcome.verdict, verdict.RESPONSE_INVALID)
        self.assertEqual(outcome.probe_kind, "auth_retry:x_api_key")
        keyed = [h for _m, _u, h, _b in transport.calls if "x-api-key" in h]
        self.assertEqual(len(keyed), 1)
        self.assertEqual(keyed[0].get("anthropic-version"), prober.ANTHROPIC_VERSION)
        self.assertNotIn("Authorization", keyed[0])

    def test_real_rejection_does_not_trigger_scheme_fallback(self):
        # "无效的令牌" is evidence about the credential, not a construction error, so
        # the ladder must stop at the first Bearer answer (07 §8.3).
        target, transport = build([("/v1/models", (401, JSON_HEADERS,
                                                   '{"error":{"message":"无效的令牌"}}'))])
        target.probe(pair(base_url="https://api.gpt.ge/v1"))
        self.assertEqual(transport.count("/v1/models"), 1,
                         "one Bearer answer is enough when it rejects the key itself")
        self.assertEqual(transport.count("/api/status"), 1, "the level-0 pre-check still ran")


class Level4PaidProbeTests(unittest.TestCase):
    """07 §8.3 level 4: the only billable step, off by default."""

    def test_disabled_by_default_even_on_404(self):
        target, transport = build([("/v1/models", (404, JSON_HEADERS, "404 page not found"))])
        outcome = target.probe(pair())
        self.assertNotIn("POST", transport.methods())
        self.assertEqual(outcome.verdict, interfaces.VERDICT_ENDPOINT_UNSUPPORTED)
        self.assertEqual(transport.count("/chat/completions"), 0)

    def test_never_fired_when_a_free_step_answered(self):
        target, transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))],
                                  cfg=Cfg(enable_paid_probe=True))
        target.probe(pair(models=("gpt-4o",)))
        self.assertNotIn("POST", transport.methods())

    def test_fires_only_after_404_405_and_with_a_known_model(self):
        target, transport = build([
            ("/v1/models", (405, JSON_HEADERS, "405 method not allowed")),
            ("/chat/completions", (200, JSON_HEADERS, '{"choices":[{"finish_reason":"stop"}]}')),
        ], cfg=Cfg(enable_paid_probe=True))
        outcome = target.probe(pair(models=("gpt-4o-mini",)))
        self.assertEqual(transport.methods().count("POST"), 1)
        self.assertEqual(outcome.probe_kind, "paid_completions")
        self.assertEqual(outcome.verdict, interfaces.VERDICT_VALID)
        sent = json.loads(transport.calls[-1][3])
        self.assertEqual(sent["max_tokens"], 1)          # the cheapest possible call
        self.assertEqual(sent["model"], "gpt-4o-mini")

    def test_paid_probe_without_a_known_model_stays_unknown(self):
        target, transport = build([("/v1/models", (404, JSON_HEADERS, "nope"))],
                                  cfg=Cfg(enable_paid_probe=True))
        outcome = target.probe(pair(models=()))
        self.assertNotIn("POST", transport.methods())
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)

    def test_paid_probe_degrades_when_the_transport_cannot_carry_a_body(self):
        seen = []

        def three_arg_transport(method, url, headers):  # the 07 §5.2 documented shape
            seen.append((method, url))
            return (404, JSON_HEADERS, "nope")

        target = prober.HttpProber(cfg=Cfg(enable_paid_probe=True),
                                   transport=three_arg_transport,
                                   gate=prober.ConcurrencyGate(min_gap_s=0.0),
                                   sleeper=lambda _s: None)
        outcome = target.probe(pair(models=("gpt-4o",)))
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertFalse([call for call in seen if call[0] == "POST"])


class RetryAndBackoffTests(unittest.TestCase):
    """07 §8.3: ``5xx/000`` -> 1s/4s/10s max 3; 429 -> Retry-After else 2^n + jitter."""

    def test_transport_failure_retries_three_times_with_the_measured_delays(self):
        waits = []
        target, transport = build([("/v1/models", (0, {}, "timeout"))],
                                  sleeper=waits.append)
        outcome = target.probe(pair())
        self.assertEqual(waits, [1.0, 4.0, 10.0])          # 07 §8.3 schedule
        self.assertEqual(transport.count("/v1/models"), 4)  # 1 try + 3 retries
        self.assertEqual(outcome.attempt_n, 4)
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)

    def test_5xx_gets_the_same_schedule_and_stays_unknown(self):
        waits = []
        target, _transport = build([("/v1/models", (502, JSON_HEADERS, "bad gateway"))],
                                  sleeper=waits.append)
        outcome = target.probe(pair())
        self.assertEqual(waits, [1.0, 4.0, 10.0])
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)

    def test_429_is_never_retried_inside_the_cycle(self):
        waits = []
        target, transport = build([("/v1/models", (429, JSON_HEADERS, "slow_down"))],
                                  sleeper=waits.append)
        outcome = target.probe(pair())
        self.assertEqual(transport.count("/v1/models"), 1)
        self.assertEqual(waits, [])
        self.assertEqual(outcome.verdict, interfaces.VERDICT_LIMITED)
        self.assertIn("retry_after", outcome.error_code)

    def test_retry_after_header_drives_the_next_round(self):
        waits = []
        target, _transport = build(
            [("/v1/models", (429, dict(JSON_HEADERS, **{"Retry-After": "13"}), "{}"))],
            sleeper=waits.append)
        outcome = target.probe(pair())
        self.assertEqual(outcome.verdict, interfaces.VERDICT_LIMITED)
        self.assertEqual(prober.retry_after_seconds({"retry-after": "13"}, 1), 13.0)

    def test_exponential_fallback_is_capped_at_60s(self):
        self.assertEqual(prober.retry_after_seconds({}, 1, rng=lambda: 0.0), 2.0)
        self.assertEqual(prober.retry_after_seconds({}, 3, rng=lambda: 0.0), 8.0)
        self.assertEqual(prober.retry_after_seconds({}, 10, rng=lambda: 0.0), 60.0)
        self.assertGreater(prober.retry_after_seconds({}, 2, rng=lambda: 0.5), 4.0)  # jitter

    def test_http_date_retry_after_falls_back_to_exponential(self):
        value = prober.retry_after_seconds({"retry-after": "Wed, 21 Oct 2015 07:28:00 GMT"},
                                           2, rng=lambda: 0.0)
        self.assertEqual(value, 4.0)

    def test_quota_429_is_not_limited(self):
        target, _transport = build([("/v1/models", (429, JSON_HEADERS,
                                                   '{"error":{"code":"credit_balance_exhausted"}}'))])
        self.assertEqual(target.probe(pair()).verdict, interfaces.VERDICT_QUOTA)


class GateTests(unittest.TestCase):
    """07 §8.3: global ≤16, per host ≤2, ≥0.5 s between same-host starts."""

    def test_defaults_come_from_interfaces(self):
        gate = prober.ConcurrencyGate()
        self.assertEqual(gate.global_limit, interfaces.PROBE_GLOBAL)
        self.assertEqual(gate.per_host_limit, interfaces.PROBE_PER_HOST)
        self.assertEqual(gate.min_gap_s, interfaces.PROBE_SAME_HOST_MIN_INTERVAL_S)

    def test_first_request_to_a_host_pays_no_gap(self):
        waits = []
        clock = [100.0]
        gate = prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.5,
                                      sleeper=waits.append, clock=lambda: clock[0])
        with gate.slot("api.openai.com"):
            pass
        self.assertEqual(waits, [], "a cold host must not be delayed (07 §8.3 gap is between "
                                    "requests, not before the first one)")

    def test_same_host_start_gap_is_enforced(self):
        waits = []
        clock = [0.0]

        def sleeper(seconds):
            waits.append(seconds)
            clock[0] += seconds

        gate = prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.5,
                                      sleeper=sleeper, clock=lambda: clock[0])
        for _ in range(3):
            with gate.slot("api.gpt.ge"):
                pass
        self.assertEqual(waits, [0.5, 0.5])
        self.assertEqual(clock[0], 1.0)

    def test_different_hosts_do_not_wait_on_each_other(self):
        waits = []
        gate = prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.5,
                                      sleeper=waits.append, clock=lambda: 0.0)
        with gate.slot("api.openai.com"):
            pass
        with gate.slot("api.groq.com"):
            pass
        # The gap is per host and a cold host pays nothing (07 §8.3 counts it
        # "between requests to the same host"), so two first-time hosts are free.
        self.assertEqual(waits, [])

    def test_a_second_request_to_the_other_host_still_waits_only_its_own_gap(self):
        waits = []
        clock = [0.0]

        def sleeper(seconds):
            waits.append(seconds)
            clock[0] += seconds

        gate = prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.5,
                                      sleeper=sleeper, clock=lambda: clock[0])
        with gate.slot("api.openai.com"):
            pass
        with gate.slot("api.groq.com"):   # cold, no wait
            pass
        self.assertEqual(waits, [])
        with gate.slot("api.groq.com"):   # warm, its own gap
            pass
        self.assertEqual(waits, [0.5])

    def test_per_host_concurrency_caps_at_two(self):
        gate = prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.0)
        target, transport = build([("/v1/models", (200, JSON_HEADERS, RELAY_OK))], gate=gate)
        transport.hold_s = 0.03
        pairs = [pair() for _ in range(6)]
        outcomes = target.probe_many(pairs)
        self.assertEqual(len(outcomes), 6)
        self.assertLessEqual(gate.max_host_inflight, 2, "07 §8.3 单主机 ≤2")
        self.assertLessEqual(transport.max_host_inflight.get("api.openai.com", 0), 2)

    def test_global_concurrency_caps_at_sixteen(self):
        gate = prober.ConcurrencyGate(global_limit=16, per_host_limit=2, min_gap_s=0.0)
        hosts = [f"relay{i}.example.com" for i in range(12)]
        table = [("/v1/models", (200, JSON_HEADERS, RELAY_OK))]
        transport = ScriptedTransport(table)
        transport.hold_s = 0.03
        clock = [10_000]
        target = prober.HttpProber(cfg=Cfg(), transport=transport, gate=gate,
                                  sleeper=lambda _s: None, now=lambda: clock[0])
        outcomes = target.probe_many([pair(base_url=f"https://{h}/v1") for h in hosts])
        self.assertEqual(len(outcomes), 12)
        self.assertLessEqual(gate.max_global_inflight, 16, "07 §8.3 全局 ≤16")
        self.assertLessEqual(transport.max_inflight, 16)

    def test_probe_many_preserves_input_order(self):
        table = [("/v1/models", (200, JSON_HEADERS, RELAY_OK))]
        target, _transport = build(table, gate=prober.ConcurrencyGate(min_gap_s=0.0))
        bases = [f"https://relay{i}.example.com/v1" for i in range(5)]
        outcomes = target.probe_many([pair(base_url=b) for b in bases])
        self.assertEqual([o.base_url for o in outcomes], bases)

    def test_probe_many_handles_one_and_none(self):
        target, _transport = build([("/v1/models", (200, JSON_HEADERS, RELAY_OK))])
        self.assertEqual(target.probe_many([]), [])
        one = target.probe_many([pair()])
        self.assertEqual(len(one), 1)
        self.assertEqual(one[0].verdict, interfaces.VERDICT_VALID)


class DebounceTests(unittest.TestCase):
    """07 §8.3: 401/403 are not retried immediately, but re-probed once after 60 s."""

    def test_second_probe_inside_the_window_is_answered_from_cache(self):
        target, transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        first = target.probe(pair())
        target.clock[0] += 10
        second = target.probe(pair())
        self.assertEqual(transport.count("/v1/models"), 1, "10 s later is inside the window")
        self.assertEqual(second.verdict, first.verdict)
        self.assertEqual(second.http_status, first.http_status)
        # Review fix (confirmed medium finding): the cached copy is the SAME
        # single observation, not a new one - it must keep the original
        # probed_at. Re-stamping it with the current clock made the state
        # machine see two "consistent invalids" 30s+ apart off ONE real 401 and
        # set dead, violating 07 §8.3 "dead 需连续 2 次一致 invalid（间隔 ≥30s）".
        self.assertEqual(second.probed_at, first.probed_at,
                         "a cached answer is not a second observation")

    def test_after_60s_the_ladder_runs_again(self):
        target, transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        target.probe(pair())
        target.clock[0] += prober.DEBOUNCE_REPROBE_S
        target.probe(pair())
        self.assertEqual(transport.count("/v1/models"), 2)

    def test_a_valid_answer_is_not_debounced(self):
        target, transport = build([("/v1/models", (200, JSON_HEADERS, RELAY_OK))])
        target.probe(pair())
        target.probe(pair())
        self.assertEqual(transport.count("/v1/models"), 2,
                         "07 §8.3 debounces rejections, not successes")


class WireShapeTests(unittest.TestCase):
    """The transport contract: capped body, ``000`` on failure, no crash paths."""

    def test_empty_base_url_never_reaches_the_transport(self):
        target, transport = build([])
        outcome = target.probe(pair(base_url=""))
        self.assertEqual(transport.calls, [])
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)
        self.assertEqual(outcome.probe_kind, "no_base_url")

    def test_transport_exception_is_unknown_not_dead(self):
        def boom(method, url, headers, body=None):
            raise ConnectionResetError("reset by peer")

        target = prober.HttpProber(cfg=Cfg(), transport=boom,
                                   gate=prober.ConcurrencyGate(min_gap_s=0.0),
                                   sleeper=lambda _s: None)
        outcome = target.probe(pair())
        self.assertEqual(outcome.http_status, 0)
        self.assertEqual(outcome.verdict, interfaces.VERDICT_UNKNOWN)

    def test_malformed_response_tuple_is_unknown(self):
        def weird(method, url, headers, body=None):
            return (None, None, None)

        target = prober.HttpProber(cfg=Cfg(), transport=weird,
                                   gate=prober.ConcurrencyGate(min_gap_s=0.0),
                                   sleeper=lambda _s: None)
        self.assertEqual(target.probe(pair()).verdict, interfaces.VERDICT_UNKNOWN)


class SecurityRedLineTests(unittest.TestCase):
    """07 §8.5: the plaintext key never enters a log row, even when the vendor echoes it."""

    def test_error_message_raw_masks_an_echoed_credential(self):
        body = '{"error":{"message":"Incorrect API key provided: %s"}}' % FAKE_KEY
        target, _transport = build([("/v1/models", (401, JSON_HEADERS, body))])
        outcome = target.probe(pair(key=FAKE_KEY))
        self.assertNotIn(FAKE_KEY, outcome.error_message_raw)
        self.assertNotIn(FAKE_KEY, repr(outcome))
        self.assertIn(interfaces.CredentialPair(key=FAKE_KEY).mask(), outcome.error_message_raw)

    def test_credential_id_is_the_hash_not_the_key(self):
        target, _transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        outcome = target.probe(pair(key=FAKE_KEY))
        self.assertEqual(outcome.credential_id, interfaces.CredentialPair(key=FAKE_KEY).hash())
        self.assertNotIn(FAKE_KEY, outcome.credential_id)
        self.assertEqual(len(outcome.credential_id), 64)

    def test_error_message_raw_is_capped_for_audit(self):
        target, _transport = build([("/v1/models", (401, JSON_HEADERS, "e" * 9_000))])
        outcome = target.probe(pair())
        self.assertLessEqual(len(outcome.error_message_raw), prober.ERROR_MESSAGE_MAX_CHARS)

    def test_outcome_is_insertable_into_the_probe_log(self):
        from store import db

        target, _transport = build([("/v1/models", (401, JSON_HEADERS, OPENAI_INVALID))])
        outcome = target.probe(pair())
        conn = db.connect_in_memory()
        db.init_db(conn)
        row_id = db.insert_probe_log(conn, outcome)
        stored = conn.execute("SELECT * FROM probe_log WHERE id = ?", (row_id,)).fetchone()
        self.assertEqual(stored["verdict"], verdict.RESPONSE_INVALID)
        self.assertEqual(stored["probe_kind"], "models")
        self.assertEqual(stored["http_status"], 401)
        conn.close()


class _HugeBodyHandler(BaseHTTPRequestHandler):
    """Serves 400 KB on /v1/models and a 307 on /v1/models/ (02 §B.1's trailing slash)."""

    def do_GET(self):  # noqa: N802 - http.server API
        if self.path == "/v1/models/":
            self.send_response(307)
            self.send_header("Location", "/v1/models")
            self.end_headers()
            return
        payload = b"y" * 400_000
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the client stopped reading after 4 KB, which is the point

    def log_message(self, *args):  # silence the test runner
        pass


class TransportFetchTests(unittest.TestCase):
    """The real transport against a localhost server: the 4 KB cap and redirect rule."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), _HugeBodyHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = "http://127.0.0.1:%d" % cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_only_the_first_4kb_of_a_400kb_body_is_read(self):
        status, _headers, body = prober.transport_fetch(
            "GET", self.origin + "/v1/models", {}, max_body_bytes=interfaces.PROBE_MAX_BODY_BYTES)
        self.assertEqual(status, 200)
        self.assertLessEqual(len(body.encode("utf-8", errors="replace")),
                             interfaces.PROBE_MAX_BODY_BYTES,
                             "07 §8.3: 只读状态行 + 前 4 KB，必须丢弃大 body")

    def test_a_larger_cap_is_honoured(self):
        _status, _headers, body = prober.transport_fetch(
            "GET", self.origin + "/v1/models", {}, max_body_bytes=100_000)
        self.assertGreater(len(body), 4_096)

    def test_redirect_is_followed_rather_than_misread_as_failure(self):
        # 02 §B.1: /v1/models/ answers 307; not following it is a false positive.
        status, _headers, body = prober.transport_fetch(
            "GET", self.origin + "/v1/models/", {}, max_body_bytes=4_096)
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith("y"))

    def test_connection_refused_becomes_status_zero(self):
        # A bound-but-never-listening socket guarantees ECONNREFUSED on a port we
        # own; tearing down the class server would poison the tests after it.
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        try:
            status, _headers, body = prober.transport_fetch(
                "GET", "http://127.0.0.1:%d/v1/models" % port, {})
        finally:
            listener.close()
        self.assertEqual(status, 0, "000 is a transport failure, not a dead key")
        self.assertTrue(body)
        self.assertEqual(verdict.classify_response(status, "", body),
                         interfaces.VERDICT_UNKNOWN)

    def test_default_prober_uses_the_capped_read(self):
        target = prober.HttpProber(cfg=Cfg())
        self.assertEqual(target.max_body_bytes, interfaces.PROBE_MAX_BODY_BYTES)


class LiveSmokeTests(unittest.TestCase):
    """Opt-in real smoke with a fabricated key (02 §B.3 precedent: read-only, zero billing).

    Skipped unless ``PROBE_SMOKE=1``, because ARCHITECTURE §2.3 keeps the default
    suite offline. Two vendors only, one request each, level 2 only (``/v1/models``),
    ``ENABLE_PAID_PROBE`` left false so no billable POST is ever built.
    """

    LIVE = os.environ.get("PROBE_SMOKE", "").strip().lower() in ("1", "true", "yes", "on")
    ENDPOINTS = ("https://api.openai.com/v1", "https://api.deepseek.com/v1")

    def test_fake_key_is_rejected_not_billed(self):
        if not self.LIVE:
            self.skipTest("set PROBE_SMOKE=1 to run the real-endpoint smoke")
        seen = []

        def recording(method, url, headers, body=None):
            seen.append((method, url))
            return prober.transport_fetch(method, url, headers, body, timeout=15.0)

        target = prober.HttpProber(
            # The real configured browser UA (02 §B.7 step 3: some relays 403 the
            # default python-urllib one), not a test string.
            cfg=load_config(),
            transport=recording,
            gate=prober.ConcurrencyGate(min_gap_s=0.0),
            sleeper=lambda _s: None,
        )
        for base in self.ENDPOINTS:
            with self.subTest(base=base):
                outcome = target.probe(pair(key=FAKE_KEY, base_url=base))
                if outcome.http_status == 0:
                    self.skipTest("%s unreachable from this host: %s"
                                  % (base, outcome.error_message_raw[:80]))
                self.assertNotIn("POST", [call[0] for call in seen], "zero billing")
                self.assertIn(outcome.http_status, (400, 401, 403, 404), outcome.error_message_raw)
                self.assertIn(outcome.verdict,
                              (verdict.RESPONSE_INVALID, interfaces.VERDICT_UNKNOWN,
                               interfaces.VERDICT_ENDPOINT_UNSUPPORTED),
                              "a fabricated key may never read as valid")
                self.assertNotEqual(outcome.verdict, interfaces.VERDICT_VALID)


if __name__ == "__main__":
    unittest.main()
