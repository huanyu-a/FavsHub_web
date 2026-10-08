"""Verdict table + state machine (07 §8.3, P0-6).

The verdict table and the false-positive rules below are transcribed from 07
§8.3, whose measurements live in 02 §B.1 / §B.2 / §B.6. Acceptance (07 P0-6): an
invalid credential must classify exactly like the 02 §B.1 measured table, and an
injected ``000`` / 403 / 429 must NEVER produce a dead verdict.

CONTRACT-ISSUE (reported, not patched - ARCHITECTURE §2.1). Three spots where the
frozen contract, 07 §8.3 and the skeleton's own fixture disagree:

1. ``interfaces.VERDICTS`` has no ``"invalid"``, yet 07 §8.3 requires an
   ``invalid`` **candidate** that is neither ``dead`` (needs two consistent
   rounds) nor transport ``unknown`` (which must not advance the counter), and
   ``fixtures/probe_response_table.json`` spells it ``expected_verdict:
   "invalid"``. Resolution here: :func:`classify_response` returns the
   response-level set :data:`RESPONSE_VERDICTS` (``VERDICTS`` + ``invalid``) and
   :meth:`StateMachine.next` folds the candidate back into a legal
   ``interfaces.VERDICTS`` value (a lone candidate persists as ``unknown``, the
   second consistent one as ``dead``), so ``token_keys.verdict`` - the column the
   page and feed read (07 F6) - never leaves the enum. Suggested fix: add
   ``VERDICT_INVALID = "invalid"`` to ``interfaces.VERDICTS``.
2. ``classify_response(status, content_type, body, headers)`` has no ``url``, but
   07 §8.3's first table row ("2xx -> valid EXCEPT an endpoint in
   OPEN_200_ENDPOINTS") is about the endpoint, and the fixture's two
   ``endpoint_unsupported`` rows are public-``/models`` 200s. ``classify_response``
   keeps its frozen signature and cannot see this; :func:`classify_request`
   (below) takes the endpoint and is what ``probe/prober.py`` calls.
3. 07 §8.3's diagram routes ``restricted`` / ``blocked_by_waf`` /
   ``endpoint_unsupported`` to "待确认/人工复核队列", but
   ``interfaces.MANUAL_REASONS`` has no matching reason and the frozen
   :meth:`next` docstring defines ``escalate`` as the unknown-5-rounds rule only.
   They are kept as per-cycle verdicts (re-evaluated every 3 h, never escalated
   to ``dead``) rather than pushed into ``manual_queue`` under a wrong reason.
"""
from __future__ import annotations

from typing import Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

from interfaces import (
    DEAD_CONSECUTIVE_INVALID,
    DEAD_CONFIRM_MIN_INTERVAL_S,
    DEAD_REPROBE_INTERVAL_S,
    UNKNOWN_ROUNDS_TO_MANUAL,
    VERDICTS,
    VERDICT_BLOCKED_BY_WAF,
    VERDICT_DEAD,
    VERDICT_ENDPOINT_UNSUPPORTED,
    VERDICT_LIMITED,
    VERDICT_QUOTA,
    VERDICT_RESTRICTED,
    VERDICT_UNKNOWN,
    VERDICT_VALID,
    ProbeOutcome,
    ProbeState,
    VerdictDecision,
    VerdictMachine,
)

#: 07 §8.3 verdict ladder, mapped onto the state machine.
#: ``probe_log.verdict`` stores the value, not this enum name.
LADDER: Tuple[str, ...] = (
    VERDICT_VALID, VERDICT_QUOTA, VERDICT_LIMITED, VERDICT_DEAD, VERDICT_UNKNOWN,
    VERDICT_RESTRICTED, VERDICT_BLOCKED_BY_WAF, VERDICT_ENDPOINT_UNSUPPORTED,
)

#: 07 §8.3 row 1's "invalid 候选": a response-level label only. Not a persisted
#: ``token_keys.verdict`` value - see CONTRACT-ISSUE 1 in the module docstring.
RESPONSE_INVALID = "invalid"

#: Everything :func:`classify_response` may return.
RESPONSE_VERDICTS: Tuple[str, ...] = (
    VERDICT_VALID, VERDICT_QUOTA, VERDICT_LIMITED, RESPONSE_INVALID,
    VERDICT_UNKNOWN, VERDICT_RESTRICTED, VERDICT_BLOCKED_BY_WAF,
    VERDICT_ENDPOINT_UNSUPPORTED,
)

#: 07 §8.3: 中转站 ``error.type`` was observed with five different literal values
#: across six relays (02 §B.1), so no literal may be trusted.
UNTRUSTED_ERROR_TYPE_LITERALS: Tuple[str, ...] = (
    "v_api_error", "rix_api_error", "new_api_error", "chatanywhere_error", "api_error",
)

#: 07 §8.3 / 02 §B.6: the message fragments that separate "invalid credential"
#: from "probe built the request wrong" when both answer 401.
NO_TOKEN_PROVIDED_HINTS: Tuple[str, ...] = ("未提供令牌", "No token provided", "No cookie auth")
INVALID_KEY_HINTS: Tuple[str, ...] = (
    "无效的令牌", "Incorrect API key", "invalid_api_key", "Invalid API Key",
    "API key is invalid", "Token is invalid", "User not found", "Wrong API Key",
    "ApiKey错误", "API key not valid", "invalid-argument", "令牌已过期或验证不正确",
    "Invalid Authentication", "invalid x-api-key",
    "API_KEY_INVALID", "Invalid Token",
)

#: 07 §8.2 / §8.3: quota exhaustion is NOT 402. These body codes mean "credential
#: valid, balance gone".
QUOTA_HINTS: Tuple[str, ...] = (
    "credit_balance_exhausted", "insufficient_user_quota",
    "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded", "用户额度不足",
)

#: 07 §8.3: Cloudflare interstitial shape.
WAF_HTML_HINTS: Tuple[str, ...] = ("Just a moment...", "cf-browser-verification")

#: 07 §8.3 restricted variants (IP allowlist / group / region), all HTTP 403.
RESTRICTED_HINTS: Tuple[str, ...] = (
    "您的 IP 不在令牌允许访问的列表中", "无权访问", "分组", "region",
)

#: Endpoints measured 200-without-auth in 02 §B.1, so a 200 there proves nothing.
#: ``openrouter.ai/api/v1/models`` (751 KB, CF-Cache HIT), ``api.novita.ai``,
#: ``api.aihubmix.com``; plus relay *management* APIs that answer 200 + success:false.
OPEN_200_ENDPOINTS: Tuple[str, ...] = (
    "openrouter.ai/api/v1/models",
    "api.novita.ai/v3/openai/models",
    "api.aihubmix.com/v1/models",
)

#: 07 §8.3's own wording for the invalid row ("message 含 invalid/无效/Incorrect/
#: not found", 02 §B.1 / §B.2). Applied to the 401 / 400 branches only - a 403
#: must never reach it ("403 永不直接判失效").
GENERIC_INVALID_MARKERS: Tuple[str, ...] = ("invalid", "无效", "incorrect", "not found")

#: 07 §8.3 400 row verbatim: "400（xAI/Google）→ API_KEY_INVALID → invalid 候选；
#: 其他 → unknown". ONLY these measured xAI/Google shapes may make a 400 an
#: invalid candidate; every other 400 (OAuth ``invalid_grant``, malformed
#: payload, a relay's own request error) is undecided, so a deterministic
#: non-credential 400 can never dead-confirm a real key across two rounds.
GOOGLE_XAI_400_HINTS: Tuple[str, ...] = (
    "API_KEY_INVALID",     # Google error status
    "invalid-argument",    # Google RPC code / the xAI shape
    "API key not valid",   # Google verbose message
)

#: 07 §8.3 rows 1-3: verdicts that prove the credential exists, so each one
#: resets the dead-confirmation counter (and recovers a wrongly dead row, 07 D3).
CONFIRMING_VALID_VERDICTS: Tuple[str, ...] = (VERDICT_VALID, VERDICT_QUOTA, VERDICT_LIMITED)

#: 07 §8.3 降误报铁律: rounds that carry no evidence about the credential. They
#: never advance and never reset the invalid counter.
NEUTRAL_VERDICTS: Tuple[str, ...] = (
    VERDICT_UNKNOWN, VERDICT_RESTRICTED, VERDICT_BLOCKED_BY_WAF,
    VERDICT_ENDPOINT_UNSUPPORTED,
)


def normalize_base_url(url: str) -> str:
    """Normalise a shared base URL to ``scheme://host/<path>`` for comparison.

    07 §8.2 pairs a key with a URL exactly as written; probing needs the two
    spellings (``https://x/`` vs ``https://x``) to dedupe to one target. Trailing
    slash matters as data, not as noise: 02 §B.1 measured ``/v1/models/`` -> 307.
    """
    raw = (url or "").strip()
    if not raw:
        return ""
    parts = urlsplit(raw if "://" in raw else "https://" + raw)
    netloc = (parts.netloc or "").lower()
    # A netloc with whitespace means the string was never a URL (a shared
    # "https //api.x.ai/v1" typo, a prose fragment); there is nothing to probe.
    if not netloc or any(character.isspace() for character in netloc):
        return ""
    scheme = (parts.scheme or "https").lower()
    path = parts.path or ""
    while path.endswith("/"):
        path = path[:-1]
    # A base URL's query / fragment carry no routing meaning for the ladder
    # (level 3 adds ``?key=`` itself), so they are dropped.
    return urlunsplit((scheme, netloc, path, "", ""))


def url_host(url: str) -> str:
    """Hostname of a URL (any normalisation applied first); ``""`` if unparsable."""
    return urlsplit(normalize_base_url(url)).netloc.split(":")[0]


def url_origin(url: str) -> str:
    """``scheme://host[:port]`` - level 0's ``GET {origin}/api/status`` target."""
    parts = urlsplit(normalize_base_url(url))
    if not parts.netloc:
        return ""
    return f"{parts.scheme}://{parts.netloc}"


def endpoint_key(url: str) -> str:
    """``host/path`` of a URL, the form :data:`OPEN_200_ENDPOINTS` is written in."""
    parts = urlsplit(normalize_base_url(url))
    if not parts.netloc:
        return ""
    return f"{parts.netloc}{parts.path}"


def is_public_endpoint(url: str) -> bool:
    """Whether ``url`` answers 200 without any credential (02 §B.1 / §B.2)."""
    key = endpoint_key(url)
    return any(key == entry or key.startswith(entry + "/") for entry in OPEN_200_ENDPOINTS)


def transport_failure_status(status: int) -> bool:
    """``000`` / timeout / 5xx: 07 §8.3's "绝不判失效" set (largest FP source, 02 §B.4)."""
    return status == 0 or status >= 500


def body_indicates(body: str, hints: Tuple[str, ...]) -> Optional[str]:
    """Return the first hint literal present in ``body`` (case-insensitive).

    07 §8.3 "必须读 body 的 5 组同码歧义": 401 / 403 / 429 / 404 / 200 all have two
    or more meanings, so the status code alone is never the verdict.
    """
    haystack = (body or "").lower()
    for hint in hints:
        if hint.lower() in haystack:
            return hint
    return None


def header_value(headers: Optional[dict], name: str) -> str:
    """Case-insensitive header lookup over a plain mapping."""
    target = (name or "").lower()
    for key, value in (headers or {}).items():
        if str(key).lower() == target:
            return str(value or "")
    return ""


def says_management_api_rejection(body: str) -> bool:
    """07 §8.3 row 6: a relay management API answering ``200 + "success": false``.

    The status code is unusable there (02 §B.1), so only the JSON flag decides.
    Whitespace-insensitive because relay JSON is not canonical.
    """
    text = (body or "").replace(" ", "").replace("\n", "").replace("\t", "")
    return '"success":false' in text


def _looks_invalid(body: str) -> bool:
    """07 §8.3 row 1: message contains invalid / 无效 / Incorrect / not found."""
    haystack = (body or "").lower()
    return any(marker in haystack for marker in GENERIC_INVALID_MARKERS)


def _auth_rejection(status: int, content_type: str, body: str) -> str:
    """401 ordering: never-before-seen reasons are checked first.

    02 §B.6 lists two false-positive shapes that can wear a 401: an IP
    allow-list ("IP 白名单会让有效凭证得到 401 **或 403**") and Cloudflare, which
    changes its status code with the UA ("换 UA 后行为还会变"). Both are screened
    before the ``invalid`` candidate, and an unexplained rejection stays
    ``unknown`` rather than guessing. (400 no longer routes here: 07 §8.3 gives
    it its own row — only the xAI/Google shapes are invalid candidates — see the
    400 branch in :func:`classify_response`.)
    """
    text = body or ""
    if body_indicates(text, WAF_HTML_HINTS) is not None or (
        "text/html" in (content_type or "").lower() and status in (401, 403, 405)
        and "just a moment" in text.lower()
    ):
        return VERDICT_BLOCKED_BY_WAF
    if body_indicates(text, NO_TOKEN_PROVIDED_HINTS) is not None:
        # 07 §8.3: "探测构造错误（换鉴权权重试）" - undecided for this round; the
        # prober retries with x-api-key / x-goog-api-key / ?key= (level 3).
        return VERDICT_UNKNOWN
    if body_indicates(text, RESTRICTED_HINTS) is not None:
        return VERDICT_RESTRICTED
    if body_indicates(text, QUOTA_HINTS) is not None:
        # 07 §8.3: the balance can also surface as a rejection; still never dead.
        return VERDICT_QUOTA
    if body_indicates(text, INVALID_KEY_HINTS) is not None or _looks_invalid(text):
        return RESPONSE_INVALID
    return VERDICT_UNKNOWN


def classify_response(status: int, content_type: str, body: str,
                      headers: Optional[dict] = None) -> str:
    """Verdict table of 07 §8.3 for one HTTP response.

    Rules, verbatim from 07 §8.3 (they are listed in the order the table gives):
      * 2xx -> ``valid``, EXCEPT an endpoint in :data:`OPEN_200_ENDPOINTS`, and
        except a relay management API answering ``200 + success:false`` (that is
        an auth failure wearing a 200);
      * 401 -> ``body_indicates(body, NO_TOKEN_PROVIDED_HINTS)`` means the probe
        itself was built wrong: retry with another auth scheme, do NOT mark
        invalid; otherwise ``invalid`` candidate;
      * 403 -> NEVER invalid (07 §8.3 "403 永不直接判失效"): split by content type
        and body into ``blocked_by_waf`` / ``quota`` / ``restricted``;
      * 429 -> ``limited``, but ``quota`` when the body matches :data:`QUOTA_HINTS`;
      * 400 -> ``invalid`` for the xAI / Google shape
        (``invalid-argument`` / ``API_KEY_INVALID``), else ``unknown``;
      * 404 / 405 -> ``endpoint_unsupported``, not invalid;
      * 0 / 5xx / timeout -> ``unknown`` (this is the largest false-positive
        source measured: 3.3% ~ 6.7% of ``000`` under 60-way concurrency, 02 §B.4).

    ``headers`` is only consulted for ``Retry-After`` style confirmation; the
    verdict must not depend on relay-specific ``error.type`` literals
    (:data:`UNTRUSTED_ERROR_TYPE_LITERALS`).

    Returns a label from :data:`RESPONSE_VERDICTS`; the public-endpoint exception
    of the first bullet needs the URL and so lives in :func:`classify_request`
    (CONTRACT-ISSUE 2).
    """
    ctype = (content_type or "").lower()
    text = body or ""

    # 000 / timeout / 5xx: 07 §8.3 "绝不判失效". 3xx reaches here only when the
    # transport did not follow it (02 §B.1: a trailing slash answers 307, and
    # "不跟随重定向会误判"); 408 is a timeout too. 402 is deliberately absent -
    # 07 §8.3 says quota exhaustion is NOT 402, so nothing may invent a verdict
    # for a code the measurement table never produced, and it falls through to
    # the undecided tail below.
    if status == 0 or status == 408 or status >= 500 or 300 <= status < 400:
        return VERDICT_UNKNOWN

    if 200 <= status < 300:
        # 07 §8.3 row 6: 200 + success:false is an auth failure wearing a 200.
        return VERDICT_UNKNOWN if says_management_api_rejection(text) else VERDICT_VALID

    if status == 400:
        # 07 §8.3 400 row verbatim: "400（xAI/Google）→ API_KEY_INVALID →
        # invalid 候选；其他 → unknown". ONLY the measured xAI/Google literals
        # make a 400 an invalid candidate — the 401 message table and the
        # generic invalid/无效/incorrect scan must NOT apply here, because a
        # deterministic non-credential 400 (OAuth invalid_grant, a malformed
        # payload) would otherwise dead-confirm a real key across two rounds.
        if body_indicates(text, WAF_HTML_HINTS) is not None:
            return VERDICT_BLOCKED_BY_WAF
        if body_indicates(text, GOOGLE_XAI_400_HINTS) is not None:
            return RESPONSE_INVALID
        return VERDICT_UNKNOWN

    if status == 401:
        return _auth_rejection(status, ctype, text)

    if status == 403:
        # 07 §8.3 铁律 "403 永不直接判失效": five meanings, split by Content-Type
        # and body (02 §B.2 case 2). An unexplained 403 is undecided, because a
        # *valid* key gets 403 from a region block (02 §B.6).
        if "text/html" in ctype and body_indicates(text, WAF_HTML_HINTS) is not None:
            return VERDICT_BLOCKED_BY_WAF
        if body_indicates(text, WAF_HTML_HINTS) is not None:
            return VERDICT_BLOCKED_BY_WAF
        if says_management_api_rejection(text):
            return VERDICT_UNKNOWN
        if body_indicates(text, QUOTA_HINTS) is not None:
            return VERDICT_QUOTA
        if body_indicates(text, RESTRICTED_HINTS) is not None:
            return VERDICT_RESTRICTED
        return VERDICT_UNKNOWN

    if status == 429:
        # 02 §B.2 case 3: same code, two meanings - the body decides.
        return VERDICT_QUOTA if body_indicates(text, QUOTA_HINTS) is not None else VERDICT_LIMITED

    if status in (404, 405):
        # 07 §8.3 row 4: "排除后 → endpoint_unsupported 不判失效". Path exclusion
        # (trailing slash, ``/v1beta/models``) is the prober's ladder; a 404 that
        # reaches here still says nothing about the credential.
        return VERDICT_ENDPOINT_UNSUPPORTED

    return VERDICT_UNKNOWN


def classify_request(endpoint: str, status: int, content_type: str, body: str,
                     headers: Optional[dict] = None) -> str:
    """Endpoint-aware verdict of 07 §8.3's table, used by ``probe/prober.py``.

    Adds the one clause :func:`classify_response`'s frozen signature cannot see
    (CONTRACT-ISSUE 2): "2xx -> valid, EXCEPT an endpoint in
    :data:`OPEN_200_ENDPOINTS`". Those endpoints answer 200 to an anonymous
    request (02 §B.1 measured 751 KB from ``openrouter.ai/api/v1/models``), so a
    200 there proves nothing about the credential and must not become ``valid``.
    """
    verdict = classify_response(status, content_type, body, headers)
    if 200 <= status < 300 and verdict == VERDICT_VALID and is_public_endpoint(endpoint):
        return VERDICT_ENDPOINT_UNSUPPORTED
    return verdict


def is_persistable(verdict: str) -> bool:
    """Whether a label may be written into ``token_keys.verdict`` (07 §8.4 enum)."""
    return verdict in VERDICTS


class StateMachine(VerdictMachine):
    """Cross-cycle verdict reducer (07 §8.3 state machine)."""

    def __init__(self, cfg=None):
        self.cfg = cfg
        #: Exposed so tests can pin the thresholds instead of copying numbers.
        self.dead_consecutive_invalid = DEAD_CONSECUTIVE_INVALID
        self.dead_confirm_min_interval_s = DEAD_CONFIRM_MIN_INTERVAL_S
        self.unknown_rounds_to_manual = UNKNOWN_ROUNDS_TO_MANUAL
        self.dead_reprobe_interval_s = DEAD_REPROBE_INTERVAL_S

    def next(self, previous: ProbeState, outcome: ProbeOutcome) -> VerdictDecision:
        """Fold one probe outcome into the persisted state.

        Contract (07 §8.3, all three clauses mandatory):
          1. ``dead`` only when the invalid counter reaches
             :data:`DEAD_CONSECUTIVE_INVALID` **and** the two confirming probes
             are at least :data:`DEAD_CONFIRM_MIN_INTERVAL_S` apart;
          2. a transport failure is ``unknown`` and must NOT advance the invalid
             counter (a single ``000`` may never contribute to a dead verdict);
          3. any ``valid`` / ``quota`` / ``limited`` result resets the counter and
             recovers a previously dead row (07 D3 "dead 每日复探可自动挽回").

        ``escalate`` is True when ``unknown`` has persisted for
        :data:`UNKNOWN_ROUNDS_TO_MANUAL` rounds (07 §8.3: unknown 连续 5 轮未决).
        """
        raw = (getattr(outcome, "verdict", "") or VERDICT_UNKNOWN)
        label = raw if raw in RESPONSE_VERDICTS else VERDICT_UNKNOWN
        probed_at = int(getattr(outcome, "probed_at", 0) or 0)
        last_probe_at = int(getattr(previous, "last_probe_at", 0) or 0)
        failures = max(0, int(getattr(previous, "consecutive_failures", 0) or 0))
        unknown_rounds = max(0, int(getattr(previous, "unknown_rounds", 0) or 0))
        was_dead = (getattr(previous, "verdict", "") or "") == VERDICT_DEAD

        if label in CONFIRMING_VALID_VERDICTS:
            # Clause 3: the credential demonstrably exists. The counter restarts
            # from zero, which is what pulls a wrongly dead row back on the daily
            # re-probe (07 D3 "dead 每天复探 1 次可自动挽回").
            return VerdictDecision(verdict=label, consecutive_failures=0,
                                   unknown_rounds=0, escalate=False)

        if was_dead and label != RESPONSE_INVALID:
            # 07 §8.3 状态机图: the ONLY arrow out of ``dead`` is 复探恢复 through
            # CONFIRMING_VALID_VERDICTS (an invalid candidate re-confirms dead in
            # its own branch below). Neutral evidence (000/5xx/restricted/waf/
            # endpoint_unsupported) — or a label from outside the table — says
            # nothing about the credential and must not resurrect a dead row
            # into the feed snapshot (D3 "dead 在 feed 剔除"): keep it dead and
            # let the daily re-probe timestamp refresh via update_verdict.
            return VerdictDecision(verdict=VERDICT_DEAD, consecutive_failures=failures,
                                   unknown_rounds=0, escalate=False)

        if label == RESPONSE_INVALID:
            failures += 1
            interval_ok = (probed_at - last_probe_at) >= self.dead_confirm_min_interval_s
            if failures >= self.dead_consecutive_invalid and (interval_ok or was_dead):
                # Clause 1. ``was_dead`` short-circuits the interval only for an
                # already-dead row, whose daily re-probe is 24 h after the last
                # probe by construction (07 §8.3 复探节奏) - a live row still has
                # to clear the 30 s debounce window.
                return VerdictDecision(verdict=VERDICT_DEAD, consecutive_failures=failures,
                                       unknown_rounds=0, escalate=False)
            # A lone candidate is undecided (02 §B.6 "单次失败记 unknown"), and so
            # is a second one inside the 30 s window: the count is kept, the
            # verdict is not escalated. The row still reads ``unknown``, so it
            # DOES spend one round of the 07 §8.3 "unknown 连续 5 轮未决" budget -
            # a key that keeps answering "invalid" without ever being confirmed
            # is exactly the thing a human should look at.
            streak = unknown_rounds + 1
            return VerdictDecision(verdict=VERDICT_UNKNOWN, consecutive_failures=failures,
                                   unknown_rounds=streak,
                                   escalate=streak >= self.unknown_rounds_to_manual)

        if label in NEUTRAL_VERDICTS:
            # Clause 2 + the 403 / 404 families: neutral evidence. Never advances
            # the invalid counter. An ``unknown`` row extends the 未决 streak (the
            # 07 §8.3 "unknown 连续 5 轮" queue); ``restricted`` / ``blocked_by_waf``
            # / ``endpoint_unsupported`` are different recorded states, so the
            # *consecutive-unknown* chain genuinely breaks - which is also what
            # :func:`store.db.count_unknown_streak` derives from the audit trail.
            streak = unknown_rounds + 1 if label == VERDICT_UNKNOWN else 0
            return VerdictDecision(
                verdict=label, consecutive_failures=failures,
                unknown_rounds=streak,
                escalate=label == VERDICT_UNKNOWN and streak >= self.unknown_rounds_to_manual,
            )

        # An outcome from outside the table (a future label, a hand-built row) is
        # undecided, never dead (07 §8.3's false-positive budget).
        unknown_rounds += 1
        return VerdictDecision(verdict=VERDICT_UNKNOWN, consecutive_failures=failures,
                               unknown_rounds=unknown_rounds,
                               escalate=unknown_rounds >= self.unknown_rounds_to_manual)

    def is_due_reprobe(self, state: ProbeState, now: int) -> bool:
        """Whether a ``dead`` row may be probed again (07 §8.3: once per day)."""
        verdict = (getattr(state, "verdict", "") or VERDICT_UNKNOWN)
        if verdict != VERDICT_DEAD:
            # Everything else rides the 3-hourly cron cadence (07 §8.3 复探节奏:
            # "valid/limited 每 3 小时随 cron"), so it is always due in a cycle.
            return True
        last_probe_at = int(getattr(state, "last_probe_at", 0) or 0)
        if last_probe_at <= 0:
            return True
        return (int(now) - last_probe_at) >= self.dead_reprobe_interval_s
