"""Generic (cross-source) classification rules (07 5.2 ``classify/rules_common.py``, D10).

Owner: classifier owner. Implemented for P0-4 (signatures unchanged from the
skeleton contract).

Layering (07 8.1 "规则分层（D10）"): **B / A1 / A2 / A3 / E are the generic
rules and live here**; C and D are linux.sb specific and live in
``rules_linux_sb.py``.

Reuse the compiled patterns from :mod:`interfaces` - they were copied verbatim
from 07 8.1 / 8.2 and re-typing them is how the four modules drift apart.

Measured hit counts to replay against (07 8.1, 板块2 / 板块8, 100 posts each):
B=11/0, A1=5/39, A2=6/28, A3=16/37, E=52/30. Replay is the P0-4 acceptance check.

IMPLEMENTATION NOTES (P0-4):

* ``Bearer`` is stripped before matching (07 §8.2 first line). A private pattern
  is used rather than importing ``extract/credentials.py``: the classifier and
  the extractor are separate deliverables and must stay independently testable.
* 07 §8.1 "必须剔除的误报源" names three sources that must never become a signal.
  None is used here: the skeleton's import of the all-caps 32-character
  affiliate-ID pattern is **removed** (it is the false-positive source itself,
  and the credential patterns cannot match that shape anyway, so there is
  nothing to exclude), no counter field is ever read, and no author identity is
  ever consulted. ``test_classify_rules.py`` guards this at source level.
* The E triage table has no 07 formula (07 only says "疑似有价值的进人工队列"),
  so it is a word list taken from the 02 §D.5 measured high-frequency words,
  deliberately recall-oriented and documented below.
"""
from __future__ import annotations

import re
from typing import List, Optional

from interfaces import (
    A1_RE,
    A2_RE,
    A3_RE,
    CATEGORY_A,
    CATEGORY_B,
    CATEGORY_E,
    GENERIC_CREDENTIAL_RE,
    GOOGLE_CREDENTIAL_RE,
    PRIMARY_CREDENTIAL_RE,
    PRIORITY_A,
    PRIORITY_B,
    PRIORITY_E,
    ClassifyRule,
    FullPost,
)

#: Compiled once at import time; classify 100+ posts per cycle.
PRIMARY_RE = re.compile(PRIMARY_CREDENTIAL_RE)
GENERIC_RE = re.compile(GENERIC_CREDENTIAL_RE)
GOOGLE_RE = re.compile(GOOGLE_CREDENTIAL_RE)
A1_PATTERN = re.compile(A1_RE)
A2_PATTERN = re.compile(A2_RE)
A3_PATTERN = re.compile(A3_RE)

#: 07 §8.2 "提取前剔除 Bearer 前缀" (``Bearer`` may be followed by a space, ``:``
#: or ``=`` in pasted ``Authorization`` headers).
BEARER_RE = re.compile(r"(?i)\bbearer[\s:=]+")

#: PRIORITY_* come from :mod:`interfaces` (single source of the 07 8.1 order).

#: 02 §D.9 last row: "2 条板块 8 正文为空、3 条板块 2 正文为 ``RT`` → 存在必须靠
#: 标题兜底的帖". Such a body carries no signal, so rules fall back to the title.
RT_ONLY_RE = re.compile(r"^rt\b[\s.。!！~、，,]*$", re.IGNORECASE)

#: 07 §8.1 E row ("疑似有价值的进人工队列") gives no formula, so this is a recall
#: oriented triage table built from the 02 §D.5 measured word lists - 板块2
#: ``福利 17`` / ``免费 9`` / ``额度 8`` / ``公益 6`` / ``无限 4`` / ``白嫖 3`` /
#: ``中转 3``, 板块8 ``中转 10`` / ``倍率 10`` / ``额度 8`` / ``免费 7`` /
#: ``公益 7`` / ``试用 6``, plus the 02 §D.5 domain slang ``鸡蛋`` (a site's
#: credit alias, 7 hits in 板块2 titles) and ``体验``. Words already owned by a
#: B/A/C/D rule are excluded so one post cannot be both classified and triaged.
#: Over-routing is cheap (07 §7.4 measures ~6 manual-queue candidates per cycle);
#: under-routing silently drops a possible benefit.
SUSPECTED_VALUE_RE = re.compile(r"福利|免费|额度|公益|无限|白嫖|中转|倍率|试用|体验|鸡蛋")


def body_text(post: FullPost) -> str:
    """Best available body of a post, never ``None`` (``FullPost.text`` or empty)."""
    return post.text or ""


def match_text(post: FullPost) -> str:
    """Text a rule matches against: the body, or the title when the body is empty.

    The title fallback is 02 §D.9's explicit boundary (empty body, or a body that
    is nothing but ``RT``); for those posts the title is the only signal left.
    """
    body = body_text(post)
    if not body.strip() or RT_ONLY_RE.match(body.strip()):
        return post.raw.title or ""
    return body


def credential_hit(text: str) -> Optional[str]:
    """Name of the credential layer that matched ``text`` (07 §8.2), else ``None``.

    Layers run in 07 §8.2 order: 主正则 -> 通用 -> Google 专用. ``Bearer`` is
    stripped first so a pasted ``Authorization: Bearer sk-...`` header line is
    still recognised.
    """
    if not text:
        return None
    stripped = BEARER_RE.sub(" ", text)
    if PRIMARY_RE.search(stripped):
        return "primary"
    if GENERIC_RE.search(stripped):
        return "generic"
    if GOOGLE_RE.search(stripped):
        return "google"
    return None


def has_credential(post: FullPost) -> bool:
    """B class: the layered credential regex hits the body (07 8.1 / 8.2).

    02 D.6 measured 11/100 in forum 2 with 0 false positives, and 0/100 in
    forum 8. B is tested **first** because tid 23295 proved a credential can sit
    inside a reply-gate - that post is B, not C.
    """
    return credential_hit(match_text(post)) is not None


def promotion_subrule(post: FullPost) -> Optional[str]:
    """Which A sub-rule fired, in 07 §8.1 order A1 -> A2 -> A3 (``None`` if none).

    Single function so ``matched_rule`` can name the exact sub-rule that hit
    (P0-4 acceptance reports precision per sub-rule, see :func:`is_promotion`).
    """
    text = match_text(post)
    if not text:
        return None
    if A1_PATTERN.search(text):
        return "A1"
    if A2_PATTERN.search(text):
        return "A2"
    if A3_PATTERN.search(text):
        return "A3"
    return None


def is_promotion(post: FullPost) -> bool:
    """A class: A1 | A2 | A3 (07 8.1).

    * A1 ``(?i)(\\?|&)aff=|/sign-up|/register|/signup`` - 5 / 39 hits, 0 false
      positives on the forum-8 sample ("极可靠");
    * A2 the promotion vocabulary table (``首充`` was removed: 0 hits in 200);
    * A3 the "register-and-get" phrasing - 16 / 37, best recall in forum 2.

    ``matched_rule`` must record which sub-rule fired (``"A1"`` / ``"A2"`` /
    ``"A3"``), because P0-4 acceptance reports precision on the 50 hand-labelled
    boundary samples per sub-rule.
    """
    return promotion_subrule(post) is not None


def is_suspected_valuable_E(post: FullPost) -> bool:
    """E-class triage: "疑似有价值的进人工队列" (07 8.1 E row, P0-9).

    Forum 2 has 52/100 posts in E (chit-chat / help requests). Only the ones that
    look valuable go to ``manual_queue`` with reason
    ``"suspected_valuable_E"`` - the rest are dropped silently.

    Implementation: :data:`SUSPECTED_VALUE_RE` over :func:`match_text`. It is a
    triage flag only - the post stays category E - and becomes
    ``ClassifiedPost.low_confidence`` (the needs-review flag) so the integrator
    routes it to ``manual_queue`` (07 §5.1 P0-9). Counters and author identity are
    never consulted (07 §8.1 banned signals).
    """
    text = match_text(post)
    return bool(text) and SUSPECTED_VALUE_RE.search(text) is not None


def common_rules() -> List[ClassifyRule]:
    """Return the generic rule set in 07 8.1 priority order (B, A, E-fallback).

    The engine appends source-specific rules (C, D) from
    ``rules_linux_sb.linux_sb_rules()``; both sets are then sorted by
    ``ClassifyRule.priority`` so the effective order is exactly B -> C -> D -> A
    -> E regardless of registration order.

    Confidence: every generic rule is high precision on the 02 corpus (B 0 false
    positives, A1 "极可靠 / 0 误判", A3 "未见明显误判"), so only the E triage rule
    carries ``low_confidence=True``. A1/A2/A3 share :data:`PRIORITY_A` and are
    registered in that order - ``sorted()`` is stable, so the engine tries A1
    first and ``matched_rule`` reports the sub-rule, not just category A.
    """

    def _a(sub: str):
        return lambda post: promotion_subrule(post) == sub

    return [
        ClassifyRule(
            name="B",
            category=CATEGORY_B,
            priority=PRIORITY_B,
            applies=has_credential,
            why="credential regex hit (07 §8.1 B row / §8.2 layers)",
        ),
        ClassifyRule(
            name="A1",
            category=CATEGORY_A,
            priority=PRIORITY_A,
            applies=_a("A1"),
            why="affiliate / signup link (07 §8.1 A1 row)",
        ),
        ClassifyRule(
            name="A2",
            category=CATEGORY_A,
            priority=PRIORITY_A,
            applies=_a("A2"),
            why="promotion vocabulary (07 §8.1 A2 row)",
        ),
        ClassifyRule(
            name="A3",
            category=CATEGORY_A,
            priority=PRIORITY_A,
            applies=_a("A3"),
            why="register-and-get phrasing (07 §8.1 A3 row)",
        ),
        ClassifyRule(
            name="E-suspected-value",
            category=CATEGORY_E,
            priority=PRIORITY_E,
            applies=is_suspected_valuable_E,
            why="benefit vocabulary in an otherwise unclaimed post -> "
                "manual_queue reason=suspected_valuable_E (07 §8.1 E row / §5.1 P0-9)",
            low_confidence=True,
        ),
    ]
