"""Probe ladder, concurrency and backoff (07 §5.2 ``probe/prober.py``, P0-6).

Ladder (07 §8.3 "探测序（成本优先）", levels 0-4):

===  ==============================  ==========================================
level  request                        purpose
===  ==============================  ==========================================
0    ``GET {origin}/api/status``     relay alive pre-check; 5xx / ``000`` marks
                                     the whole host ``unknown`` for this cycle
1    vendor native read-only         e.g. OpenRouter ``GET /api/v1/key`` (its
                                     ``/v1/models`` is public, so useless here)
2    ``GET {base}/models`` + Bearer  the main check; read status line + headers +
                                     **first 4 KB only** (bodies reached 751 KB)
3    retry other auth schemes        ``x-api-key`` / ``x-goog-api-key`` / ``?key=``
4    ``POST /chat/completions``      only when 2-3 answered 404/405. **The only
                                     billable step**, gated by ``ENABLE_PAID_PROBE``
===  ==============================  ==========================================

Never send the probe before level 2 without the pre-check, and never treat a
transport error as a dead key (:mod:`probe.verdict`).

CONTRACT-ISSUE (reported, not patched - ARCHITECTURE §2.1). Three spots where the
frozen contract, 07 §8.3 and the skeleton's own fixture disagree; all three are
handled inside this package, none of them by editing a locked file:

1. ``interfaces.VERDICTS`` has no ``"invalid"`` member, but 07 §8.3 requires an
   ``invalid`` *candidate* that is neither ``dead`` (2 consistent rounds) nor
   transport ``unknown`` (which must not advance the counter), and
   ``fixtures/probe_response_table.json`` spells it ``expected_verdict:
   "invalid"``. ``probe.verdict`` carries it as ``RESPONSE_INVALID`` and
   ``StateMachine.next`` folds it back into a legal ``interfaces.VERDICTS`` value
   before anything reaches ``token_keys.verdict``. Suggested skeleton fix: add
   ``VERDICT_INVALID = "invalid"`` to ``interfaces.py``.
2. ``verdict.classify_response(status, content_type, body, headers)`` has no URL
   argument, yet 07 §8.3's 2xx row is conditional on the endpoint ("EXCEPT an
   endpoint in OPEN_200_ENDPOINTS"). ``verdict.classify_request(endpoint, ...)``
   supplies it; every request in this ladder goes through it.
3. ``main.run_cycle`` never fills ``ProbeOutcome.credential_id`` (it mints a fresh
   ``token_keys.id`` per upsert), so this prober emits ``pair.hash()`` - the only
   stable, credential-free identifier derivable from a ``CredentialPair``,
   joinable against ``token_keys.key_hash``. Suggested skeleton fix: assign
   ``outcome.credential_id = cid`` in ``run_cycle``.
"""
from __future__ import annotations

import functools
import inspect
import json
import random
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from crypto import mask as _mask
from interfaces import (
    PROBE_GLOBAL,
    PROBE_MAX_BODY_BYTES,
    PROBE_PER_HOST,
    PROBE_SAME_HOST_MIN_INTERVAL_S,
    VERDICT_ENDPOINT_UNSUPPORTED,
    VERDICT_UNKNOWN,
    CredentialPair,
    ProbeOutcome,
    Prober,
)
from probe import verdict

#: Backoff schedule for 5xx / ``000`` / timeout: 1s, 4s, 10s, max 3 tries
#: (07 §8.3 "5xx/``000`` -> 1s/4s/10s 最多 3 次").
RETRY_DELAYS_S: Sequence[float] = (1.0, 4.0, 10.0)

#: Single-request wall-clock budget. Cross-vendor baseline was 1.37 s, domestic
#: 0.27 s, and ``api.aihubmix.com`` once took 25.02 s (02 §B.4).
REQUEST_TIMEOUT_S = 20.0

#: 07 §8.3: 401/403 are not retried immediately, but re-probed once after 60 s.
#: Used as the in-cycle debounce window: a second request for the same
#: ``(credential_id, base_url)`` inside it is answered from the first response
#: instead of burning another request.
DEBOUNCE_REPROBE_S = 60

#: Vendor-specific native endpoints that actually validate a key (02 §B.1).
#: Anything listed here must be probed at level 1 instead of level 2.
NATIVE_VALIDATION_ENDPOINTS = {
    # OpenRouter /models is a public 200 (751 KB) - key check lives here instead.
    "openrouter.ai": "/api/v1/key",
}

#: Endpoints that answer 200 without any credential, so a 200 proves nothing
#: (02 §B.1 / §B.2). A hit here forces the level-1 vendor endpoint.
PUBLIC_200_ENDPOINTS = (
    "openrouter.ai/api/v1/models",
    "api.novita.ai/v3/openai/models",
    "api.aihubmix.com/v1/models",
)

#: Hosts measured in 02 §B.1 that serve an OpenAI-style ``/v1/models`` on their
#: own authority. ``GET {origin}/api/status`` (07 §8.3 level 0) is a New API /
#: one-api relay feature - 02 §B.3 measured it live on ``api.gpt.ge`` and
#: ``api.chatfire.cn`` - so pre-checking a first-party vendor would only burn a
#: request on a 404.
VENDOR_HOSTS: Tuple[str, ...] = (
    "api.openai.com",
    "api.deepseek.com",
    "openrouter.ai",
    "api.anthropic.com",
    "generativelanguage.googleapis.com",
    "api.x.ai",
    "api.groq.com",
    "api.mistral.ai",
    "api.siliconflow.cn",
    "api.moonshot.cn",
    "open.bigmodel.cn",
    "dashscope.aliyuncs.com",
    "api.cerebras.ai",
    "api.fireworks.ai",
    "api.novita.ai",
    "api.aihubmix.com",
)

#: Level-3 alternative auth schemes, in the order 07 §8.3 lists them
#: (``x-api-key`` / ``x-goog-api-key`` / ``?key=``; New API accepts all three -
#: 02 §B.5 citing ``middleware/auth.go:366-386``).
AUTH_SCHEMES: Tuple[str, ...] = ("x_api_key", "x_goog_api_key", "query_key")

#: 02 §B.1 / §B.7 step 5: Anthropic wants a version header next to ``x-api-key``.
ANTHROPIC_VERSION: str = "2023-06-01"

#: Verdicts that do not end the ladder: ``unknown`` (07 §8.3's "401 未提供令牌 =
#: 探测构造错误 -> 换鉴权重试" case lands here) and ``endpoint_unsupported`` (a
#: wrong path says nothing about the credential).
NON_DECIDING_VERDICTS: Tuple[str, ...] = (VERDICT_UNKNOWN, VERDICT_ENDPOINT_UNSUPPORTED)

#: Audit cap for ``probe_log.error_message_raw`` (the transport already capped the
#: wire read at :data:`interfaces.PROBE_MAX_BODY_BYTES`).
ERROR_MESSAGE_MAX_CHARS = 400

#: ``GET {origin}/api/status`` path (07 §8.3 level 0).
RELAY_STATUS_PATH = "/api/status"

#: Google's native models path, cross-checked when ``{base}/models`` 404s
#: (02 §B.1 measured ``/v1beta/models``; §B.6 "试 /v1beta/models").
GOOGLE_MODELS_PATH = "/v1beta/models"

TransportResult = Tuple[int, Dict[str, str], str]


def models_url(base_url: str) -> str:
    """Build the level-2 ``/models`` URL from a pair's base URL.

    Base URLs already carry the vendor path (``https://api.groq.com/openai/v1``,
    ``https://api.x.ai/v1``), so this must append, not replace, and must tolerate
    a missing or doubled trailing slash (02 §B.1: a trailing slash answers 307).
    """
    base = verdict.normalize_base_url(base_url)
    if not base:
        return ""
    return base + "/models"


def looks_like_relay(base_url: str) -> bool:
    """Whether 07 §8.3's level-0 ``/api/status`` pre-check applies to this URL.

    True for every host that is not a measured first-party vendor
    (:data:`VENDOR_HOSTS`): a relay's ``/api/status`` is public (02 §B.3), so a
    5xx / ``000`` there marks the whole host ``unknown`` for the cycle.
    """
    host = verdict.url_host(verdict.normalize_base_url(base_url))
    return bool(host) and host not in VENDOR_HOSTS


def transport_fetch(method: str, url: str, headers: Dict[str, str],
                    body: Optional[bytes] = None,
                    timeout: float = REQUEST_TIMEOUT_S,
                    max_body_bytes: int = PROBE_MAX_BODY_BYTES) -> TransportResult:
    """Default transport: one HTTP request, first ``max_body_bytes`` of the body.

    07 §8.3 step 2 is explicit that a successful ``/models`` body can reach
    751 KB, so exactly one capped read is issued and the response is closed
    before the rest arrives; the remainder is never downloaded. Redirects are
    followed (02 §B.1 measured ``/v1/models/`` -> 307 and §B.6 warns that not
    following one is a false positive). Every connection-layer failure - DNS,
    refused, timeout - becomes status ``0``, the ``000`` of 02 §B.4, which the
    verdict table turns into ``unknown`` and never into a dead credential.

    ``body`` exists for the level-4 billable step only; the documented 3-argument
    contract transport (07 §5.2) is unchanged for levels 0-3.
    """
    request = urllib.request.Request(url, method=method.upper(),
                                     headers=dict(headers or {}), data=body)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read(max_body_bytes)
            status = int(getattr(response, "status", 0) or response.getcode())
            out_headers = {str(k).lower(): str(v) for k, v in dict(response.headers).items()}
    except urllib.error.HTTPError as exc:  # a real status: 400 / 401 / 403 / 404 / 429 / 5xx
        try:
            payload = exc.read(max_body_bytes)
        except Exception:  # pragma: no cover - body already drained or socket closed
            payload = b""
        status = int(exc.code)
        out_headers = {str(k).lower(): str(v) for k, v in dict(exc.headers or {}).items()}
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        return 0, {}, f"{type(exc).__name__}: {reason}"
    except Exception as exc:  # pragma: no cover - unexpected transport quirk
        return 0, {}, f"{type(exc).__name__}: {exc}"
    return status, out_headers, payload.decode("utf-8", errors="replace")


def retry_after_seconds(headers: Optional[Dict[str, str]], attempt_n: int = 1,
                        rng: Callable[[], float] = random.random) -> float:
    """429 backoff (07 §8.3): ``Retry-After`` first, else ``min(60s, 2^n x 1s)`` + jitter.

    ``Retry-After`` is read in its delta-seconds form (02 §B.4: OpenAI says it
    "may be present"); an HTTP-date or junk value falls back to the exponential
    rule. The jitter is ``rng()`` seconds on top, so a batch that hit 429
    together does not come back together (02 §B.4 "缺失时退避 + jitter").
    """
    raw = verdict.header_value(headers, "Retry-After")
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass  # HTTP-date form (or garbage): exponential schedule decides
    return min(60.0, 2.0 ** max(1, int(attempt_n))) + max(0.0, float(rng()))


def transport_backoff_s(attempt_index: int,
                        delays: Sequence[float] = RETRY_DELAYS_S) -> float:
    """The 5xx / ``000`` wait before retry ``attempt_index + 1`` (1s / 4s / 10s)."""
    if attempt_index < 0:
        return 0.0
    if attempt_index < len(delays):
        return float(delays[attempt_index])
    return float(delays[-1]) if delays else 0.0


class ConcurrencyGate:
    """07 §8.3 concurrency envelope: global ≤16, per host ≤2, ≥0.5 s gap per host.

    Plain ``threading`` primitives, and by default one process-wide instance
    (:data:`DEFAULT_GATE`), because "全局 ≤16" is a budget for the whole cycle,
    not per object. The same-host gap is measured between request *starts* under
    a short-lived lock, so two concurrent requests to one host are still allowed
    (≤2) while a burst cannot start faster than ``min_gap_s`` apart - the exact
    shape 02 §B.4 measured at 60-way concurrency, where 3.3-6.7 % of requests
    came back ``000`` and became the largest false-positive source.

    Lock order is always global -> host, so two hosts cannot deadlock against each
    other and a slow host cannot hold the global budget beyond its own slot.
    """

    def __init__(self, global_limit: int = PROBE_GLOBAL,
                 per_host_limit: int = PROBE_PER_HOST,
                 min_gap_s: float = PROBE_SAME_HOST_MIN_INTERVAL_S,
                 sleeper: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.global_limit = int(global_limit)
        self.per_host_limit = int(per_host_limit)
        self.min_gap_s = float(min_gap_s)
        self._sleeper = sleeper
        self._clock = clock
        self._global_sem = threading.BoundedSemaphore(self.global_limit)
        self._hosts: Dict[str, Dict[str, object]] = {}
        self._hosts_lock = threading.Lock()
        #: Peak occupancy counters, for assertions and for the daily report.
        self.max_global_inflight = 0
        self.max_host_inflight = 0
        self._stats_lock = threading.Lock()
        self._inflight_global = 0
        self._inflight_host: Dict[str, int] = {}

    def _host_state(self, host: str) -> Dict[str, object]:
        with self._hosts_lock:
            state = self._hosts.get(host)
            if state is None:
                state = {
                    "sem": threading.BoundedSemaphore(self.per_host_limit),
                    "gap": threading.Lock(),
                    #: ``None`` = this host has never started a request, so the
                    #: first one pays no gap; only *subsequent* starts wait.
                    "last_start": None,
                }
                self._hosts[host] = state
            return state

    def _note_enter(self, host: str) -> None:
        with self._stats_lock:
            self._inflight_global += 1
            self._inflight_host[host] = self._inflight_host.get(host, 0) + 1
            self.max_global_inflight = max(self.max_global_inflight, self._inflight_global)
            self.max_host_inflight = max(self.max_host_inflight, self._inflight_host[host])

    def _note_exit(self, host: str) -> None:
        with self._stats_lock:
            self._inflight_global -= 1
            self._inflight_host[host] = self._inflight_host.get(host, 1) - 1

    @contextmanager
    def slot(self, host: str):
        """Hold one global and one per-host token for the duration of a request."""
        key = (host or "").strip() or "?"
        self._global_sem.acquire()
        state = self._host_state(key)
        sem = state["sem"]
        gap = state["gap"]
        # ``sem``/``gap`` come straight from :meth:`_host_state`; the locals are
        # only for readability (``threading.Lock`` is a factory, not a type, so
        # there is nothing meaningful to isinstance-check here).
        sem.acquire()
        try:
            with gap:
                last_start = state["last_start"]
                if last_start is not None:
                    wait = float(last_start) + self.min_gap_s - self._clock()
                    if wait > 0:
                        self._sleeper(wait)
                state["last_start"] = self._clock()
            self._note_enter(key)
            try:
                yield
            finally:
                self._note_exit(key)
        finally:
            sem.release()
            self._global_sem.release()


#: Process-wide default envelope (07 §8.3 "全局 ≤16").
DEFAULT_GATE = ConcurrencyGate()


class HttpProber(Prober):
    """Level 0-4 prober with the 07 §8.3 concurrency and backoff envelope."""

    def __init__(self, cfg=None, transport=None, gate: Optional[ConcurrencyGate] = None,
                 sleeper: Optional[Callable[[float], None]] = None,
                 timeout: float = REQUEST_TIMEOUT_S,
                 retry_delays: Sequence[float] = RETRY_DELAYS_S,
                 now: Optional[Callable[[], int]] = None):
        #: ``cfg.enable_paid_probe`` gates level 4 (07 §8.3, default false).
        self.cfg = cfg
        #: Injectable ``fetch(method, url, headers) -> (status, headers, body4k)``
        #: so unit tests never touch the network. A 4th ``body`` argument is only
        #: ever passed by the level-4 step; a transport without one is detected
        #: once here and level 4 degrades to ``unknown`` instead of guessing.
        self.max_body_bytes = PROBE_MAX_BODY_BYTES
        self.timeout = float(timeout)
        if transport is None:
            self.transport: Callable[..., TransportResult] = functools.partial(
                transport_fetch, timeout=self.timeout, max_body_bytes=self.max_body_bytes)
        else:
            self.transport = transport
        self.transport_accepts_body = self._detect_body_support(transport)
        self.per_host_limit = PROBE_PER_HOST
        self.global_limit = PROBE_GLOBAL
        self.min_same_host_gap_s = PROBE_SAME_HOST_MIN_INTERVAL_S
        #: Retry / backoff waits go through this, so a unit test asserts the
        #: 07 §8.3 schedules without sleeping for up to 60 s.
        self.sleeper = sleeper or time.sleep
        self.retry_delays = tuple(retry_delays)
        self.gate = gate if gate is not None else DEFAULT_GATE
        self._now = now or (lambda: int(time.time()))
        #: In-cycle debounce: ``{(credential_id, base_url): (deadline, outcome)}``
        #: for the 401/403 "60s 后复探 1 次去抖" window (07 §8.3).
        self._debounce: Dict[Tuple[str, str], Tuple[int, ProbeOutcome]] = {}
        self._debounce_lock = threading.Lock()

    @staticmethod
    def _detect_body_support(transport) -> bool:
        """Whether the injected transport can carry a POST body (4th argument)."""
        if transport is None:
            return True  # the default transport takes ``body``
        try:
            signature = inspect.signature(transport)
        except (TypeError, ValueError):  # pragma: no cover - exotic callables
            return True
        positional = [
            p for p in signature.parameters.values()
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
        ]
        if len(positional) >= 4:
            return True
        return any(p.kind is p.VAR_POSITIONAL or p.name == "body" for p in signature.parameters.values())

    # ------------------------------------------------------------------
    # request plumbing
    # ------------------------------------------------------------------

    def _fetch(self, method: str, url: str, headers: Optional[Dict[str, str]] = None,
               body: Optional[bytes] = None) -> TransportResult:
        """One gated request: browser UA (02 §B.7 step 3), global / per-host limits."""
        request_headers = dict(headers or {})
        ua = getattr(self.cfg, "ua", "") or ""
        if ua:
            request_headers.setdefault("User-Agent", ua)
        request_headers.setdefault("Accept", "application/json")
        if body is not None:
            request_headers.setdefault("Content-Type", "application/json")
        with self.gate.slot(verdict.url_host(url)):
            try:
                if body is None:
                    status, resp_headers, text = self.transport(method.upper(), url, request_headers)
                else:
                    status, resp_headers, text = self.transport(
                        method.upper(), url, request_headers, body)
            except Exception as exc:  # a transport blow-up is ``000``, never a dead key
                return 0, {}, f"{type(exc).__name__}: {exc}"
        # A transport that returns a non-integer status is misbehaving, and the
        # ladder must not crash on it: an unusable answer is ``000``, i.e.
        # ``unknown`` (07 §8.3 never lets a transport problem read as a dead key).
        try:
            safe_status = int(status)
        except (TypeError, ValueError):
            return 0, {}, f"transport returned an unusable status: {status!r}"
        return safe_status, {str(k).lower(): str(v) for k, v in (resp_headers or {}).items()}, text

    def _fetch_with_retry(self, method: str, url: str,
                          headers: Optional[Dict[str, str]] = None,
                          body: Optional[bytes] = None) -> Tuple[TransportResult, int]:
        """07 §8.3 "5xx/``000`` -> 1s/4s/10s 最多 3 次". Returns (response, attempts).

        429 is never retried here: the verdict table decides on it (``limited`` /
        ``quota``, both "凭证有效"), so waiting inside one cycle would buy nothing
        - :func:`retry_after_seconds` is what the next round must use instead.
        401 / 403 are also not retried in place (07 §8.3: they go through the
        debounce path above / the ladder's level-3 auth switch).
        """
        attempts = len(self.retry_delays) + 1
        response: TransportResult = (0, {}, "")
        for index in range(attempts):
            response = self._fetch(method, url, headers, body)
            if not verdict.transport_failure_status(response[0]):
                return response, index + 1
            if index < attempts - 1:
                self.sleeper(transport_backoff_s(index, self.retry_delays))
        return response, attempts

    def _outcome(self, pair: Optional[CredentialPair], probe_kind: str,
                 response: TransportResult, attempts: int = 1,
                 endpoint: str = "", verdict_label: Optional[str] = None) -> ProbeOutcome:
        """Freeze one response into the 1:1 ``probe_log`` row (07 §8.4 / §8.3)."""
        status, headers, body = response
        base_url = pair.base_url if pair is not None else ""
        credential_id = pair.hash() if (pair is not None and pair.key) else ""
        content_type = headers.get("content-type", "")
        decided = verdict_label or verdict.classify_request(
            endpoint, status, content_type, body, headers)
        message = (body or "")[:ERROR_MESSAGE_MAX_CHARS]
        if pair is not None and pair.key:
            # 07 §8.5: the audit column must never carry the plaintext key, even
            # when a vendor echoes back what it was sent.
            message = message.replace(pair.key, _mask(pair.key))
        return ProbeOutcome(
            credential_id=credential_id,
            base_url=base_url,
            probe_kind=probe_kind,
            http_status=int(status),
            verdict=decided,
            error_code=self._error_code(body),
            error_message_raw=message,
            attempt_n=int(attempts),
            probed_at=self._now(),
        )

    @staticmethod
    def _error_code(body: str) -> str:
        """A hint literal from 07 §8.3's own lists, never ``error.type`` (untrusted)."""
        for hints in (verdict.NO_TOKEN_PROVIDED_HINTS, verdict.QUOTA_HINTS,
                      verdict.RESTRICTED_HINTS, verdict.INVALID_KEY_HINTS,
                      verdict.WAF_HTML_HINTS):
            hit = verdict.body_indicates(body, hints)
            if hit:
                return hit
        return ""

    # ------------------------------------------------------------------
    # the ladder
    # ------------------------------------------------------------------

    def precheck_host(self, base_url: str) -> Optional[ProbeOutcome]:
        """Level 0 relay pre-check (07 §8.3).

        Returning an outcome means "this host is down for the cycle" and every
        credential on it becomes ``unknown`` without further requests.
        """
        base = verdict.normalize_base_url(base_url)
        if not base or not looks_like_relay(base):
            return None
        # Level 0 is a liveness check, not a credential check: 3 tries at most
        # (07 §8.3's 1s/4s/10s) and no authorization header at all.
        response, attempts = self._fetch_with_retry(
            "GET", verdict.url_origin(base) + RELAY_STATUS_PATH)
        status = response[0]
        if verdict.transport_failure_status(status):
            # "5xx/000 → 本轮该主机全标 unknown 并跳过". Anything else the relay
            # answers (200, 404, even a CF 403 - 02 §B.6 measured /api/status 403
            # while /v1/models answered 401 normally) proves the host is up.
            outcome = self._outcome(None, "api_status", response, attempts=attempts,
                                    endpoint=verdict.url_origin(base) + RELAY_STATUS_PATH)
            outcome.base_url = base_url
            return outcome
        return None

    def probe(self, pair: CredentialPair) -> ProbeOutcome:
        """Run the ladder for one pair and return the first deciding outcome.

        The returned :class:`interfaces.ProbeOutcome` carries the raw
        ``error_message_raw`` for audit only - it must never reach the feed, the
        page or an alert body (07 §8.5).
        """
        base = verdict.normalize_base_url(pair.base_url)
        if not base:
            return self._outcome(pair, "no_base_url", (0, {}, "empty or unparsable base_url"))

        debounce_key = (pair.hash(), pair.base_url)
        cached = self._debounced(debounce_key)
        if cached is not None:
            return cached

        down = self.precheck_host(base)
        if down is not None:
            # 07 §8.3: the whole host is unknown this cycle; the credential itself
            # has produced no evidence, so the counter must not move.
            down.credential_id = pair.hash() if pair.key else ""
            down.base_url = pair.base_url
            return down

        host = verdict.url_host(base)
        origin = verdict.url_origin(base)
        attempts_log: List[ProbeOutcome] = []

        # ---- level 1: vendor native read-only endpoint -----------------------
        native = NATIVE_VALIDATION_ENDPOINTS.get(host)
        if native:
            url = origin + native
            outcome = self._attempt(pair, "native", url, self._bearer(pair))
            attempts_log.append(outcome)
            if self._decides(outcome):
                return self._commit(debounce_key, outcome)

        # ---- level 2: GET {base}/models + Bearer -----------------------------
        targets = [models_url(base)]
        if host == "generativelanguage.googleapis.com":
            targets.append(origin + GOOGLE_MODELS_PATH)  # 02 §B.1 / §B.7 step 5
        # A base that already ends in ``/v1`` and a hand-written native path can
        # spell the same target twice; the ladder must not spend two requests on
        # one endpoint.
        targets = list(dict.fromkeys(targets))
        for url in targets:
            outcome = self._attempt(pair, "models", url, self._bearer(pair))
            attempts_log.append(outcome)
            if self._decides(outcome):
                return self._commit(debounce_key, outcome)
            if self._terminal_public_answer(outcome):
                # The endpoint answers 200 while ignoring the credential (02
                # §B.1: openai-proxy listing front pages such as api.novita.ai
                # and aihubmix.com). No auth scheme can change that answer and
                # level 4 only fires on 404/405, so the evidence stops here -
                # three more identical requests would add nothing but load.
                return self._commit(debounce_key, outcome)
            if verdict.transport_failure_status(outcome.http_status):
                # The key endpoint itself is unhealthy: burning level 3 against a
                # host that is not answering is exactly how ``000`` turns into a
                # false positive (02 §B.4). Stop and report ``unknown``.
                return self._commit(debounce_key, outcome)

        # ---- level 3: same endpoint, other auth schemes ----------------------
        target = targets[0]
        for scheme in AUTH_SCHEMES:
            headers, suffix = self._scheme_request(scheme, pair, target)
            outcome = self._attempt(pair, f"auth_retry:{scheme}", target + suffix, headers)
            attempts_log.append(outcome)
            if self._decides(outcome):
                return self._commit(debounce_key, outcome)

        # ---- level 4: the only billable step ---------------------------------
        if self._paid_probe_allowed(attempts_log):
            outcome = self._paid_probe(pair, base)
            attempts_log.append(outcome)
            return self._commit(debounce_key, outcome)

        return self._commit(debounce_key, attempts_log[-1])

    def _attempt(self, pair: CredentialPair, kind: str, url: str,
                 headers: Dict[str, str]) -> ProbeOutcome:
        """One ladder step: request, retry policy, endpoint-aware verdict."""
        response, attempts = self._fetch_with_retry("GET", url, headers)
        outcome = self._outcome(pair, kind, response, attempts=attempts, endpoint=url)
        if outcome.http_status == 429:
            # 07 §8.3: keep the next round's wait derivable from the response.
            outcome.error_code = outcome.error_code or "retry_after=%g" % retry_after_seconds(
                response[1], attempts)
        return outcome

    def _decides(self, outcome: ProbeOutcome) -> bool:
        """Whether this response ends the ladder with a verdict about the key."""
        return outcome.verdict not in NON_DECIDING_VERDICTS

    def _terminal_public_answer(self, outcome: ProbeOutcome) -> bool:
        """A 2xx that says "this endpoint does not take credentials" (02 §B.1).

        ``endpoint_unsupported`` from a 404/405 must NOT stop the ladder - level
        4 is gated on "levels 2 and 3 all 404/405" (07 §8.3), so the other auth
        schemes still have to run. But an ``/models`` that answers 200 for
        anybody - the openai-proxy listing front pages measured in 02 §B.1, e.g.
        api.novita.ai and aihubmix.com - returns the identical body under every
        scheme, so levels 3 and 4 add requests and no evidence. Stopping here
        still records ``endpoint_unsupported``, which is a different state from
        ``unknown`` and does not advance the dead counter.
        """
        return (outcome.verdict == VERDICT_ENDPOINT_UNSUPPORTED
                and 200 <= outcome.http_status < 300)

    def _commit(self, debounce_key: Tuple[str, str], outcome: ProbeOutcome) -> ProbeOutcome:
        """Cache a 401/403-shaped result for the 60 s debounce window (07 §8.3)."""
        if outcome.http_status in (401, 403):
            deadline = self._now() + DEBOUNCE_REPROBE_S
            with self._debounce_lock:
                self._debounce[debounce_key] = (deadline, outcome)
        return outcome

    def _debounced(self, debounce_key: Tuple[str, str]) -> Optional[ProbeOutcome]:
        """The previous 401/403 answer, while it is still inside the debounce window.

        "401/403 不重试但 60s 后复探 1 次去抖" (07 §8.3): the same ``(key,
        base_url)`` can appear in several posts of one cycle; re-asking the vendor
        within the window adds requests and, at OpenAI, consumes the account's
        per-minute budget for a failed call (02 §B.4) without adding evidence.
        """
        now = self._now()
        with self._debounce_lock:
            entry = self._debounce.get(debounce_key)
            if entry is None:
                return None
            deadline, outcome = entry
            if deadline <= now:
                del self._debounce[debounce_key]
                return None
            # The copy KEEPS the original probed_at: it is the SAME single
            # observation, not a new one (07 §8.3 "401/403 不重试但 60s 后复探 1 次
            # 去抖" — the whole point of the window is that no second request is
            # made). Refreshing probed_at to `now` made the state machine treat
            # one real 401 as two consistent invalids 30s+ apart and could set
            # dead off a single failure - the exact false-positive the two-
            # consistent rule exists to prevent.
            return ProbeOutcome(
                credential_id=outcome.credential_id, base_url=outcome.base_url,
                probe_kind=outcome.probe_kind, http_status=outcome.http_status,
                verdict=outcome.verdict, error_code=outcome.error_code,
                error_message_raw=outcome.error_message_raw,
                attempt_n=outcome.attempt_n, probed_at=outcome.probed_at,
            )

    def _bearer(self, pair: CredentialPair) -> Dict[str, str]:
        return {"Authorization": f"Bearer {pair.key}"}

    def _scheme_request(self, scheme: str, pair: CredentialPair,
                        url: str) -> Tuple[Dict[str, str], str]:
        """Level-3 request shape for one auth scheme (02 §B.5 / new-api middleware).

        The ``Authorization: Bearer`` header is *replaced*, not added (07 §8.3
        "换鉴权方案重试"), because a stale Bearer is what makes a relay answer
        "未提供令牌" in the first place (02 §B.6 records three different
        no-credential wordings).
        """
        if scheme == "x_api_key":
            headers = {"x-api-key": pair.key}
            if verdict.url_host(url) == "api.anthropic.com":
                headers["anthropic-version"] = ANTHROPIC_VERSION
            return headers, ""
        if scheme == "x_goog_api_key":
            return {"x-goog-api-key": pair.key}, ""
        if scheme == "query_key":
            # 02 §B.5: New API also authenticates ``?key=`` on /v1/models. The key
            # goes into the query string, URL-encoded, and never into an outcome
            # field (_outcome masks it out of error_message_raw).
            glue = "&" if urllib.parse.urlparse(url).query else "?"
            return {}, f"{glue}key={urllib.parse.quote(pair.key, safe='')}"
        return {}, ""

    def _paid_probe_allowed(self, attempts_log: Sequence[ProbeOutcome]) -> bool:
        """07 §8.3 level 4: only when 2/3 answered 404/405 and the switch is on.

        Three independent gates, all mandatory: ``ENABLE_PAID_PROBE=true`` (default
        false, the step costs money), at least one level 2-3 attempt, and *every*
        one of them a 404/405 - a 401 or a ``000`` already produced a usable
        verdict and a paid request would only bill a guess.
        """
        if not bool(getattr(self.cfg, "enable_paid_probe", False)):
            return False
        relevant = [o for o in attempts_log if o.probe_kind.startswith(("models", "auth_retry"))]
        return bool(relevant) and all(o.http_status in (404, 405) for o in relevant)

    def _paid_probe(self, pair: CredentialPair, base: str) -> ProbeOutcome:
        """Level 4: ``POST {base}/chat/completions`` with ``max_tokens=1``.

        A model name is mandatory. Guessing one could bill an unexpected
        endpoint, so a pair whose extractor found no model stops at ``unknown``
        instead of firing the paid request.
        """
        url = base + "/chat/completions"
        models = [m for m in (pair.models or ()) if m]
        if not models:
            return self._outcome(pair, "paid_completions",
                                 (0, {}, "ENABLE_PAID_PROBE on, but no model known for the paid step"))
        if not self.transport_accepts_body:
            return self._outcome(pair, "paid_completions",
                                 (0, {}, "ENABLE_PAID_PROBE on, but the transport cannot send a POST body"))
        payload = json.dumps({
            "model": models[0], "max_tokens": 1, "stream": False,
            "messages": [{"role": "user", "content": "ping"}],
        }, ensure_ascii=False).encode("utf-8")
        response, attempts = self._fetch_with_retry("POST", url, self._bearer(pair), payload)
        return self._outcome(pair, "paid_completions", response, attempts=attempts, endpoint=url)

    # ------------------------------------------------------------------
    # batch entry point (the envelope the 07 §8.3 concurrency numbers describe)
    # ------------------------------------------------------------------

    def probe_many(self, pairs: Sequence[CredentialPair]) -> List[ProbeOutcome]:
        """Probe a batch concurrently, inside :data:`PROBE_GLOBAL` worker threads.

        ``main.run_cycle`` walks its pairs one at a time; this is the form the P1
        scheduler and the integration reuse need, and the reason
        :class:`ConcurrencyGate` exists at all. The gate, not the thread count, is
        the authority: a batch of 100 pairs against one host still issues at most
        2 concurrent requests, 0.5 s apart.
        """
        items = list(pairs)
        if not items:
            return []
        if len(items) == 1:
            return [self.probe(items[0])]
        outcomes: List[Optional[ProbeOutcome]] = [None] * len(items)
        workers = max(1, min(self.global_limit, len(items)))

        def worker(index: int, pair: CredentialPair) -> None:
            outcomes[index] = self.probe(pair)

        queue = list(enumerate(items))
        lock = threading.Lock()

        def runner() -> None:
            while True:
                with lock:
                    if not queue:
                        return
                    index, pair = queue.pop(0)
                worker(index, pair)

        threads = [threading.Thread(target=runner, daemon=True) for _ in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        return [o if o is not None else self.probe(p) for o, p in zip(outcomes, items)]
