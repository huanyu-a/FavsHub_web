"""Cross-module contracts for the tokenhub crawler (P0 skeleton).

Single source of truth for the dataclasses, ABCs, enums, thresholds and regexes
shared by ``sources`` / ``classify`` / ``extract`` / ``probe`` / ``publish`` /
``store``. Owned by the skeleton author: implementation owners MUST NOT edit this
file - report a wrong contract instead (see ARCHITECTURE.md), otherwise the four
concurrent developers drift apart.

Every value mirrors ``docs/07-最终执行方案.md`` §8.1-§8.4 verbatim (the doc
escapes ``|`` as ``\|`` inside markdown table cells; the constants here are the
de-escaped, runnable regexes).

Security (07 §8.5): a plaintext credential must never reach a repr, log, feed,
report or fixture. ``CredentialPair`` masks its ``key`` in ``__repr__`` and only
:func:`crypto.encrypt_secret` output may be persisted.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable, List, Sequence


# ---------------------------------------------------------------------------
# Enumerations (07 §8.1 / §8.4) - stored as plain strings in SQLite.
# ---------------------------------------------------------------------------

#: Post categories. Decision order is fixed: B -> C -> D -> A -> E (07 §8.1).
CATEGORY_B = "B"  #: credential shared in the post (11 hits / 0 false, forum 2)
CATEGORY_C = "C"  #: reply-gated content (6 / 0, forum 2)
CATEGORY_D = "D"  #: point / card sales post (16 / 11 in forum 2 / 8)
CATEGORY_A = "A"  #: promotion, affiliate, referral (21 / 62)
CATEGORY_E = "E"  #: fallback, everything else (52 / 30)
CATEGORIES: Sequence[str] = (CATEGORY_B, CATEGORY_C, CATEGORY_D, CATEGORY_A, CATEGORY_E)

#: A-class sub-rules (07 §8.1). ``matched_rule`` records which one fired.
A_SUBRULES: Sequence[str] = ("A1", "A2", "A3")

#: Evaluation order fixed by 07 §8.1: B -> C -> D -> A -> E, first hit wins.
#: Defined once here so classify/engine.py, rules_common.py and
#: rules_linux_sb.py cannot disagree about the priority of the same rule.
PRIORITY_B = 0
PRIORITY_C = 1
PRIORITY_D = 2
PRIORITY_A = 3
PRIORITY_E = 4

#: Liveness verdicts - ``token_keys.verdict`` (07 §8.4).
VERDICTS: Sequence[str] = (
    "valid",
    "quota",
    "limited",
    "dead",
    "unknown",
    "restricted",
    "blocked_by_waf",
    "endpoint_unsupported",
)

#: Named verdicts, so ``dead`` / ``valid`` are never mistyped in four modules.
VERDICT_VALID = "valid"
VERDICT_QUOTA = "quota"
VERDICT_LIMITED = "limited"
VERDICT_DEAD = "dead"
VERDICT_UNKNOWN = "unknown"
VERDICT_RESTRICTED = "restricted"
VERDICT_BLOCKED_BY_WAF = "blocked_by_waf"
VERDICT_ENDPOINT_UNSUPPORTED = "endpoint_unsupported"

#: (key, base_url) pairing confidence (07 §8.2).
CONFIDENCE_HIGH = "high"
CONFIDENCE_MEDIUM = "medium"
CONFIDENCE_LOW = "low"
CONFIDENCES: Sequence[str] = (CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, CONFIDENCE_LOW)

#: Row provenance - ``token_keys.source`` (07 §8.4).
KEY_SOURCE_POST = "post"
KEY_SOURCE_AGGREGATOR_LEAK = "aggregator_leak"
#: C-class guide row: link + instruction, zero key data (07 D2).
KEY_SOURCE_REPLY_VISIBLE_GUIDE = "reply_visible_guide"
KEY_SOURCES: Sequence[str] = (
    KEY_SOURCE_POST, KEY_SOURCE_AGGREGATOR_LEAK, KEY_SOURCE_REPLY_VISIBLE_GUIDE
)

#: Notice-and-takedown visibility (07 §8.4 ``deal_status``, D12).
DEAL_STATUSES: Sequence[str] = ("published", "hidden")

#: ``manual_queue.reason`` values (07 §5.1 P0-9, §8.1, §8.3).
MANUAL_REASONS: Sequence[str] = (
    "low_confidence_classify",
    "low_confidence_pairing",
    "suspected_valuable_E",
    "card_or_paid_benefit_info",
    "unknown_5_rounds",
)

#: Named aliases so a reason string is never typed by hand in four places.
REASON_LOW_CONFIDENCE_CLASSIFY = "low_confidence_classify"
REASON_LOW_CONFIDENCE_PAIRING = "low_confidence_pairing"
REASON_SUSPECTED_VALUABLE_E = "suspected_valuable_E"
REASON_CARD_OR_PAID_BENEFIT_INFO = "card_or_paid_benefit_info"
REASON_UNKNOWN_5_ROUNDS = "unknown_5_rounds"


# ---------------------------------------------------------------------------
# Thresholds (each traceable to a 07 sentence).
# ---------------------------------------------------------------------------

#: "unknown 连续5轮未决 -> 人工队列" (07 §8.3).
UNKNOWN_ROUNDS_TO_MANUAL = 5

#: "dead 需连续 2 次一致 invalid" (07 §8.3).
DEAD_CONSECUTIVE_INVALID = 2

#: "...（间隔 ≥30s，必要时换 UA）" (07 §8.3).
DEAD_CONFIRM_MIN_INTERVAL_S = 30

#: "probe_log 保留 90 天：爬虫每轮顺带一条 DELETE" (07 §5.1 P0-7, 06 修订).
PROBE_LOG_RETENTION_DAYS = 90

#: "dead 每天复探 1 次可自动挽回" (07 §8.3 / D3).
DEAD_REPROBE_INTERVAL_S = 24 * 3600

#: "正文前40字符指纹去重" (07 §四 ①, §5.1 P0-2).
FINGERPRINT_LEN = 40

#: Enrichment failure degrades to the 200-char aggregator text (07 §5.1 P0-3).
TRUNCATED_BODY_LEN = 200

#: Aggregator page ceiling: "limit 上限 100" (07 §三, 02 §A.3).
AGG_LIMIT_MAX = 100

#: "单主机 ≤2、全局 ≤16、同主机间隔 ≥0.5s" (07 §8.3).
PROBE_PER_HOST = 2
PROBE_GLOBAL = 16
PROBE_SAME_HOST_MIN_INTERVAL_S = 0.5

#: "只读状态行 + 前 4 KB，必须丢弃大 body" (07 §8.3 probe step 2).
PROBE_MAX_BODY_BYTES = 4096

#: "行距 ≤3 行" is the medium-pairing condition (07 §8.2 pairing table).
PAIR_MEDIUM_MAX_LINE_GAP = 3

#: Safety cap on probe-disambiguation requests per post. NOT a 07 number (07 only
#: says "候选组合各发一次 GET /v1/models"); without a cap a pathological post
#: with 50 keys x 10 URLs could burn 500 requests per cycle.
PAIR_DISAMBIG_MAX_CANDIDATES = 8


# ---------------------------------------------------------------------------
# Regexes / markers - copied VERBATIM from 07 §8.1 / §8.2 (de-escaped).
# ---------------------------------------------------------------------------
# Import these instead of re-typing: a divergent pattern silently changes the
# measured hit counts in 07 §8.1 and breaks P0-4 / P0-5 acceptance replay.

#: 07 §8.2 "主正则（提取前剔除 Bearer 前缀）".
PRIMARY_CREDENTIAL_RE = (
    r"(?<![A-Za-z0-9_\-])(?:sk-(?:or-v1|ant(?:-api\d{2})?|proj|svcacct|admin|live|test)-?"
    r"|gsk_|xai-|fw_|hf_|pplx-|r8_|csk-|AIza)[A-Za-z0-9_\-]{10,220}"
)

#: 07 §8.2 "通用".
GENERIC_CREDENTIAL_RE = r"\bsk-[A-Za-z0-9_\-]{20,220}\b"

#: 07 §8.2 "Google 专用（误报最低）".
GOOGLE_CREDENTIAL_RE = r"\bAIza[0-9A-Za-z_\-]{35}\b"

#: 07 §8.1 C class: the placeholder the forum injects for reply-gated text.
#: ``🔒`` is deliberately NOT part of it (the loose variant cost 14% precision).
C_CLASS_RE = r"\[回复可见\]|回复后可见|回复本主题后即可查看"

#: 07 §8.1 D class DOM badges (checked before the keyword fallback).
D_BADGE_MARKERS: Sequence[str] = (".virtual-card-box", "virtual-card-title-status")

#: 07 §8.1 D class keyword fallback. (02 §D.7 listed more words; 07 §8.1 is
#: authoritative and keeps exactly these five.)
D_KEYWORDS_RE = r"兑换|积分|发卡|卡密|CDK"

#: 07 §8.1 A1 affiliate / signup links.
A1_RE = r"(?i)(\?|&)aff=|/sign-up|/register|/signup"

#: 07 §8.1 A2 promotion vocabulary (``首充`` removed: 0 hits in 200 samples).
A2_RE = r"邀请码|邀请链接|inviteCode|referral|返利|优惠|折扣|佣金|推广"

#: 07 §8.1 A3 "register-and-get" phrasing.
A3_RE = r"注册.{0,8}(送|领|得|赠)|(送|领|得|赠).{0,8}(额度|刀|美金|\$)"

#: 07 §8.1 "必须剔除的误报源": "32 位以上大写字母数字串" (precision 0/3 - all
#: affiliate IDs such as ``?aff=b0de70219c...``). The doc words it in Chinese;
#: this is that description as a pattern.
AFFILIATE_ID_FALSE_POSITIVE_RE = r"\b[A-Z0-9]{32,}\b"

#: 02 §D.7 row D' (high precision, low recall). NOT present in 07 §8.1, so it is
#: optional: never a primary signal.
CDK_RE = r"\b[A-Z0-9]{4}(-[A-Z0-9]{4}){1,}\b"

#: 07 §8.2 "前缀启发（猜来源不替代 URL）". Guess only.
PREFIX_BASE_URL_HINTS: Sequence[tuple] = (
    ("sk-or-", "openrouter.ai"),
    ("sk-ant", "api.anthropic.com"),
    ("AIza", "generativelanguage.googleapis.com"),
    ("gsk_", "api.groq.com/openai/v1"),
    ("xai-", "api.x.ai/v1"),
    ("fw_", "api.fireworks.ai/inference/v1"),
)

#: 07 §8.1 B priority ordering (B=0 ... E=4). The engine sorts by it.
RULE_PRIORITY_B, RULE_PRIORITY_C, RULE_PRIORITY_D, RULE_PRIORITY_A, RULE_PRIORITY_E = 0, 1, 2, 3, 4

#: 07 §四 ② DOM marker for a reply-gated post (measured 4/4 vs 0 for controls).
REPLY_VISIBLE_LOCKED_MARKER = "nb-editor-reply-visible-locked"

#: 07 §四 ② JSON-LD node whose ``articleBody`` holds the full first post.
JSONLD_POSTING_TYPE = "DiscussionForumPosting"


# ---------------------------------------------------------------------------
# Classification rule contract (D10: generic vs source-specific rules)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ClassifyRule:
    """One registered classification rule (07 §8.1 "规则分层").

    ``applies`` takes a :class:`FullPost` and returns True on a hit. The engine
    evaluates by ascending ``priority`` and stops at the first hit, then falls
    back to E - so B(0) -> C(1) -> D(2) -> A(3) is enforced by data, not by code
    order, whichever package registered the rule.
    """

    name: str
    category: str
    priority: int
    applies: Callable[["FullPost"], bool]
    #: Recorded into ``ClassifiedPost.note`` / ``manual_queue.detail``.
    why: str = ""
    #: True for rules whose hits must go to ``manual_queue`` instead of feed.
    low_confidence: bool = False


# ---------------------------------------------------------------------------
# Discovery / enrichment payloads
# ---------------------------------------------------------------------------


@dataclass
class RawPost:
    """A post as seen from the aggregator API (07 §四 ①; fields per 02 §A.3).

    ``content_text`` is the aggregator copy, truncated around 200 chars;
    :meth:`SourceAdapter.enrich` recovers the full first-post text. Field names
    match the aggregator JSON keys so the adapter stays a thin mapper.
    """

    tid: int
    title: str
    forum_id: int
    forum_name: str
    author_name: str
    url: str
    content_text: str = ""
    post_time: str = ""
    views_count: int = 0
    replies_count: int = 0
    likes_count: int = 0
    #: Source identifier (D10), e.g. ``"linux_sb"``; becomes ``token_keys.source_id``.
    source_id: str = "linux_sb"

    def fingerprint(self) -> str:
        """First :data:`FINGERPRINT_LEN` chars of the body (07 §四 ① dedupe)."""
        return (self.content_text or "").strip()[:FINGERPRINT_LEN]


@dataclass
class FullPost:
    """A post after enrichment (07 §四 ②, P0-3).

    ``article_body`` comes from the topic page's JSON-LD ``@graph`` ->
    :data:`JSONLD_POSTING_TYPE` node -> ``articleBody``, which beats the
    aggregator's ~200-char truncation.
    """

    raw: RawPost
    article_body: str = ""
    #: ``nb-editor-reply-visible-locked`` present in the HTML -> C-class evidence.
    reply_visible_locked: bool = False
    #: ``.virtual-card-box`` / ``virtual-card-title-status`` present -> D class.
    virtual_card: bool = False
    #: False when enrichment failed and the truncated text is used (P0-3 degrade).
    enriched: bool = False

    @property
    def tid(self) -> int:
        return self.raw.tid

    @property
    def source_id(self) -> str:
        return self.raw.source_id

    @property
    def text(self) -> str:
        """Best available body: full text if enriched, else truncated text."""
        if self.enriched and self.article_body:
            return self.article_body
        return self.raw.content_text


@dataclass
class ClassifiedPost:
    """Result of the B -> C -> D -> A -> E engine (07 §8.1, P0-4)."""

    post: FullPost
    category: str
    #: Rule name that fired, e.g. ``"B"``, ``"C"``, ``"D-badge"``, ``"A1"``.
    matched_rule: str = ""
    #: Low confidence hits route to ``manual_queue`` rather than the feed.
    low_confidence: bool = False
    note: str = ""


# ---------------------------------------------------------------------------
# Credential extraction / pairing
# ---------------------------------------------------------------------------


@dataclass
class CredentialPair:
    """A ``(key, base_url)`` pairing with confidence (07 §8.2, P0-5).

    ``key`` is plaintext and exists only transiently in memory. It is masked in
    ``__repr__``; the only lawful persistence is ``crypto.encrypt_secret`` output
    plus :func:`crypto.mask` / :func:`crypto.sha256_hex` (07 §8.4 / §8.5).
    """

    key: str
    base_url: str = ""
    provider: str = ""
    models: Sequence[str] = ()
    #: One of :data:`CONFIDENCES`.
    confidence: str = "low"
    #: One of :data:`KEY_SOURCES`.
    origin: str = "post"
    source_id: str = "linux_sb"
    source_tid: int = 0
    #: Short audit trail for the pairing decision - never contains the key.
    evidence: str = ""

    def __repr__(self) -> str:  # redact the secret
        return (
            f"CredentialPair(key={self.mask()!r}, base_url={self.base_url!r}, "
            f"provider={self.provider!r}, confidence={self.confidence!r}, "
            f"origin={self.origin!r}, source_tid={self.source_tid!r})"
        )

    def mask(self) -> str:
        """:func:`crypto.mask` of the key (07 §8.4 ``key_masked``)."""
        from crypto import mask as _mask

        return _mask(self.key)

    def hash(self) -> str:
        """sha256 of the key (07 §8.4 ``key_hash``, the dedupe half)."""
        from crypto import sha256_hex as _sha

        return _sha(self.key)


# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------


@dataclass
class ProbeOutcome:
    """One probe attempt (07 §8.3 / §8.4). Maps 1:1 onto a ``probe_log`` row.

    ``error_message_raw`` is audit-only and must never reach a page, the feed or
    an alert body (07 §8.5 rule 3).
    """

    credential_id: str
    base_url: str
    #: Probe ladder step, e.g. ``api_status``, ``native``, ``models``,
    #: ``auth_retry``, ``paid_completions`` (07 §8.3 levels 0-4).
    probe_kind: str
    #: HTTP status; ``0`` means transport failure (``000`` / timeout).
    http_status: int
    #: One of :data:`VERDICTS`.
    verdict: str
    error_code: str = ""
    error_message_raw: str = ""
    attempt_n: int = 1
    probed_at: int = 0


@dataclass
class ProbeState:
    """Persisted liveness state of one credential (07 §8.4 columns)."""

    verdict: str = "unknown"
    consecutive_failures: int = 0
    last_probe_at: int = 0
    #: Rounds this credential has sat at ``unknown`` (07 §8.3: 5 -> manual queue).
    unknown_rounds: int = 0


@dataclass
class VerdictDecision:
    """New state produced by :meth:`VerdictMachine.next`."""

    verdict: str
    consecutive_failures: int
    unknown_rounds: int = 0
    #: True when the row must also be pushed into ``manual_queue``.
    escalate: bool = False


# ---------------------------------------------------------------------------
# Publishing payloads
# ---------------------------------------------------------------------------


@dataclass
class FeedEntry:
    """One RSS item / page record. Masked data only (07 §8.5 rule 1)."""

    source_id: str
    source_tid: int
    source_url: str
    title: str
    category: str
    verdict: str = "unknown"
    confidence: str = "low"
    provider: str = ""
    base_url: str = ""
    #: Masked key (first 6 + last 4). Empty for C-class guide entries.
    key_masked: str = ""
    #: C-class instruction ("回复本主题后即可查看"); empty for B entries.
    guide_text: str = ""


# ---------------------------------------------------------------------------
# Abstract pipeline stages (each implemented by one owner)
# ---------------------------------------------------------------------------


class SourceAdapter(ABC):
    """One forum source: discovery + enrichment (07 §5.2 ``sources/base.py``, D10).

    Adding a source means one new subclass plus its source-specific classify
    rules; nothing in ``classify`` / ``extract`` / ``probe`` / ``store`` changes.
    """

    #: Written into ``token_keys.source_id`` (07 §8.4 composite source key).
    source_id: str = ""

    @abstractmethod
    def discover(self, since_tid: int) -> List[RawPost]:
        """Posts with ``tid > since_tid``.

        Aggregator API first (UA mandatory or 403; ``limit`` max 100; forums from
        config), ``sitemap.xml`` ``lastmod`` as fallback, and the fallback must
        fire an alert (07 §5.4 ⑥). Dedupe by :meth:`RawPost.fingerprint`.
        """

    @abstractmethod
    def enrich(self, post: RawPost) -> FullPost:
        """Fetch ``/topic/{tid}`` and parse JSON-LD ``articleBody``.

        Also sniff :data:`REPLY_VISIBLE_LOCKED_MARKER` and
        :data:`D_BADGE_MARKERS`. On failure return ``enriched=False`` with the
        truncated text - never raise into the cycle (07 §5.1 P0-3).
        """

    def classify_rules(self) -> Sequence[ClassifyRule]:
        """Source-specific rules (C / D for linux.sb) registered into the engine.

        Generic rules come from ``classify/rules_common.py``; this hook is what
        keeps the engine itself source-agnostic (D10). Default: no extras.
        """
        return ()


class Classifier(ABC):
    """B -> C -> D -> A -> E rule engine (07 §8.1, P0-4)."""

    @abstractmethod
    def classify(self, post: FullPost) -> ClassifiedPost:
        """Classify one post. B is tested first because tid 23295 showed a
        credential can live inside a reply-gate (it is B, not C)."""


class CredentialExtractor(ABC):
    """Layered regex + pairing + probe disambiguation (07 §8.2, P0-5)."""

    @abstractmethod
    def extract(self, post: FullPost) -> List[CredentialPair]:
        """Return every ``(key, base_url)`` pair for a B-class body.

        Strip a leading ``Bearer`` prefix before matching (07 §8.2), and never
        split the tail of an ``sk-`` key on ``-`` (that is New API's own bug).
        """


class Prober(ABC):
    """Probe ladder 0-4 (07 §8.3, P0-6)."""

    @abstractmethod
    def probe(self, pair: CredentialPair) -> ProbeOutcome:
        """Probe one pair once.

        Transport failure (``000`` / timeout / 5xx) yields ``unknown`` - never a
        dead verdict (07 §8.3: it is the largest false-positive source, 3.3-6.7%
        measured under concurrency). Level 4 is the only billable step and is
        gated by ``ENABLE_PAID_PROBE``.
        """


class VerdictMachine(ABC):
    """Pure state machine: (previous state, outcome) -> new state (07 §8.3)."""

    @abstractmethod
    def next(self, previous: ProbeState, outcome: ProbeOutcome) -> VerdictDecision:
        """Encode the 07 §8.3 rules: ``dead`` only after 2 consistent invalids
        at least 30s apart; 403 is never dead; ``unknown`` for 5 rounds escalates."""


class FeedBuilder(ABC):
    """RSS 2.0 feed, atomically written (07 §5.2, P0-8, §8.5)."""

    @abstractmethod
    def build(self, entries: Sequence[FeedEntry]) -> str:
        """XML text: ``dead`` excluded (D3), plaintext keys never present (§8.5)."""

    @abstractmethod
    def write(self, xml: str) -> str:
        """Write via a temp file + ``os.replace`` in the same directory, so a
        reader never sees a half-written feed (07 §5.2 "原子写")."""


class Reporter(ABC):
    """Daily report (07 §5.1 P0-8 / P0-9)."""

    @abstractmethod
    def build(self, stats: dict) -> str:
        """New post count, class distribution, new keys, verdict changes,
        exceptions, manual-queue additions."""

    @abstractmethod
    def write(self, text: str) -> str:
        """Persist one dated file under ``report_dir``; return its path."""
