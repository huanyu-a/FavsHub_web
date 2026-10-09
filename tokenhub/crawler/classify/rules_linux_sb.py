"""linux.sb specific classify rules (07 §5.2 ``classify/rules_linux_sb.py``, D10).

Owner: classifier owner. IMPLEMENTED for P0-4 (signatures unchanged). These two
classes exist ONLY for linux.sb, which is why
07 §8.1 keeps them out of ``rules_common.py``. They are handed to the engine by
``sources.linux_sb.LinuxSbAdapter.classify_rules()`` so the engine stays generic.

IMPLEMENTATION NOTES (P0-4):

* C and D are registered here with :data:`interfaces.PRIORITY_C` /
  :data:`interfaces.PRIORITY_D`; the engine's priority sort (not this file's
  order) is what enforces B -> C -> D -> A -> E.
* Badge-first ordering inside D is expressed as two rules sharing
  :data:`interfaces.PRIORITY_D`, registered badge-then-keyword: ``sorted()`` is
  stable, so the badge is evaluated first and the keyword fallback is reached
  only when no badge was sniffed.
* ``🔒`` is not, and never becomes, a signal here (07 §8.1 C row: the loose
  variant cost 14% of precision because tid 23165 used it as a bullet).
* None of the three banned false-positive sources of 07 §8.1 is referenced:
  no all-caps 32-character string pattern, no page-counter field, no
  writer-identity table.
"""
from __future__ import annotations

import re
from typing import List, Optional

from interfaces import (
    CATEGORY_C,
    CATEGORY_D,
    C_CLASS_RE,
    D_BADGE_MARKERS,
    D_KEYWORDS_RE,
    REPLY_VISIBLE_LOCKED_MARKER,
    ClassifyRule,
    FullPost,
    PRIORITY_C,
    PRIORITY_D,
)

from classify.rules_common import match_text

C_PATTERN = re.compile(C_CLASS_RE)
D_PATTERN = re.compile(D_KEYWORDS_RE)

#: 07 §8.1 D disposition: record 标题 + 链接 + 价格 as 福利情报 only, never the
#: paid payload. 02 §A.5 shape:
#: ``<div class="virtual-card-price"><strong>88</strong><span>积分 / 张</span></div>``
CARD_PRICE_RE = re.compile(
    r'<div[^>]*class="[^"]*virtual-card-price[^"]*"[^>]*>\s*'
    r"<strong>([^<]+)</strong>\s*(?:<span>([^<]*)</span>)?",
    re.IGNORECASE,
)

#: 07 §8.1 C row: the three strings the forum injects, matched on the raw text
#: returned by the aggregator (it is NOT filtered there, 02 §D.6).
#: ``🔒`` is deliberately absent - 02 §D.7 C′ measured precision 86% with it
#: because tid 23165 used it as a bullet character.
def is_reply_visible(post: FullPost) -> bool:
    """C class: reply-gate placeholder in the text (07 §8.1, 6/0 hits).

    Two accepted forms of the same gate, both cited by 07 §8.1's C row:

    1. the injected placeholder text (``[回复可见]`` / ``回复后可见`` /
       ``回复本主题后即可查看``) in the best available body, or in the title when
       the body is empty / a bare ``RT`` (02 §D.9);
    2. :attr:`interfaces.FullPost.reply_visible_locked`, the DOM marker
       ``nb-editor-reply-visible-locked`` sniffed by enrichment - 07 §8.1
       measures it at 4/4 against a 0-hit control set, and it is what still
       identifies a gated post when the placeholder sits past the aggregator's
       200-character truncation (02 §D.8: 27/100 and 29/100 bodies are exactly
       200 chars).

    The lock emoji alone matches neither, so it cannot classify anything.
    """
    if C_PATTERN.search(match_text(post) or ""):
        return True
    return bool(post.reply_visible_locked)


def _badge_present(post_html: str) -> bool:
    """Shared badge test for :func:`is_card_post` and the D-badge rule."""
    if not post_html:
        return False
    for marker in D_BADGE_MARKERS:
        #: 07 §8.1 writes the first marker as the CSS selector
        #: ``.virtual-card-box``; the page markup carries the bare class name, so
        #: the leading dot is stripped before the substring test.
        if marker.lstrip(".") in post_html:
            return True
    return False


def is_card_post(post_html: str) -> bool:
    """D class badge check - runs on the topic HTML, not the plain text.

    07 §8.1 gives the badges priority over the keyword fallback, and ``FullPost``
    already carries the sniffed ``virtual_card`` flag from enrichment (P0-3), so
    in the normal pipeline the engine reads that flag instead of re-parsing HTML.
    This helper is the HTML-level check enrichment itself uses.

    Note 02 §A.5 vs §A.6: the topic-body fragment carries the price box while
    ``virtual-card-title-status`` is on the *list* row, so enrichment must sniff
    the fetched page HTML (not the JSON-LD ``articleBody``) for these markers.
    """
    return _badge_present(post_html)


def card_price(post_html: str) -> Optional[str]:
    """Extract the price shown in a card post's ``.virtual-card-price`` box.

    07 §8.1 D disposition: record 标题 + 链接 + 价格 as 福利情报 only. 02 A.5 shows
    the markup shape (``<span class=\"virtual-card-status\">库存 292</span>``,
    ``<div class=\"virtual-card-price\"><strong>88</strong><span>积分 / 张</span>``).
    ``None`` when there is no price. Never extract the download link itself - that
    is the paid payload (D class is record-only).

    Returns the value and unit joined, e.g. ``"88 积分 / 张"`` for the 02 §A.5 /
    ``fixtures/linux_sb_virtual_card.json`` markup.
    """
    if not post_html:
        return None
    match = CARD_PRICE_RE.search(post_html)
    if not match:
        return None
    value = (match.group(1) or "").strip()
    unit = (match.group(2) or "").strip()
    if not value:
        return None
    return f"{value} {unit}".strip()


def linux_sb_rules() -> List[ClassifyRule]:
    """The source-specific rule set: C (priority 1) then D (priority 2).

    D must be built with ``low_confidence=True`` when it fired on the keyword
    fallback rather than the badge, because 02 D.7 shows ``积分`` also appears in
    lottery posts (``A∩D=4``) - those go to ``manual_queue`` with reason
    ``card_or_paid_benefit_info`` (07 §5.1 P0-9).

    Both D rules carry the reason in ``why`` because 07 §8.1's disposition applies
    to the whole class - badge hits included - and the integrator needs
    ``matched_rule`` to tell the two apart when it files the 福利情报 record.
    """
    return [
        ClassifyRule(
            name="C",
            category=CATEGORY_C,
            priority=PRIORITY_C,
            applies=is_reply_visible,
            why="reply-gate placeholder text, or the DOM marker "
            f"{REPLY_VISIBLE_LOCKED_MARKER} (07 §8.1 C row); "
            "store as guide only - 不提取不存储 key (07 §5.3 / D2)",
        ),
        ClassifyRule(
            name="D-badge",
            category=CATEGORY_D,
            priority=PRIORITY_D,
            applies=lambda post: bool(post.virtual_card),
            why="card badge sniffed by enrichment (07 §8.1 D row, badge outranks "
            "the keyword); record 标题+链接+价格 as 福利情报, NO extraction/probe "
            "(07 §5.1 P0-9 reason=card_or_paid_benefit_info)",
        ),
        ClassifyRule(
            name="D-keyword",
            category=CATEGORY_D,
            priority=PRIORITY_D,
            applies=lambda post: bool(D_PATTERN.search(match_text(post) or "")),
            why="keyword fallback 兑换|积分|发卡|卡密|CDK (07 §8.1 D row); "
            "积分 also occurs in lottery posts (02 §D.7 A∩D=4) so the hit is "
            "low confidence -> manual_queue reason=card_or_paid_benefit_info",
            low_confidence=True,
        ),
    ]
