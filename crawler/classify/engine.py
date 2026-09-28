"""Rule-engine scaffold: fixed order B -> C -> D -> A -> E (07 8.1, P0-4).

Owner: classifier owner. IMPLEMENTED for P0-4 (the skeleton's signature and the
contract constraints below are unchanged).

Registration (D10): the generic set comes from ``rules_common.common_rules()``
and each source appends its own set (``rules_linux_sb.linux_sb_rules()``). The
engine sorts by ``ClassifyRule.priority`` so the evaluation order is always
B(0) -> C(1) -> D(2) -> A(3) -> E(4) no matter how rules were registered, and
**stops at the first hit** (07 8.1: B 优先于 C, proven by tid 23295).

Low-confidence routing (07 8.1 / P0-9): D-class keyword-only hits and E-class
"suspected valuable" hits set ``ClassifiedPost.low_confidence`` and are pushed to
``manual_queue`` instead of being published.

IMPLEMENTATION NOTES (P0-4)
---------------------------
CONTRACT-ISSUE: ``main.run_cycle`` (stage ④) extracts and probes every category
except C, but 07 §8.1's D row is explicit that D is record-only ("不提取不探测"),
and P0-9 wants D filed under ``reason=card_or_paid_benefit_info`` rather than the
generic low-confidence reason. ``classify`` cannot express that with
``ClassifiedPost``'s contract fields alone (``low_confidence`` only reaches
``manual_queue`` via ``REASON_LOW_CONFIDENCE_CLASSIFY``). Proposal for the
skeleton owner: gate stage ④ on ``item.category not in (CATEGORY_C, CATEGORY_D)``
and map the reason from ``matched_rule``. Nothing here works around it silently.

Confidence output: the contract exposes confidence as the boolean
``ClassifiedPost.low_confidence`` (the needs-review flag the integrator turns into
a ``manual_queue`` row), so the engine mirrors it into ``note`` as a ``high`` /
``low`` label next to the rule's provenance - no numeric score is invented (07
§8.1 measures rules by hit / false-positive counts, not by scores, and 07 §7.4's
LLM re-judge of low-confidence hits is P2).
"""
from __future__ import annotations

from typing import Dict, Iterable, List

from interfaces import (
    CATEGORIES,
    CATEGORY_E,
    ClassifyRule,
    ClassifiedPost,
    Classifier,
    FullPost,
)

#: Fallback recorded when no rule hit (07 8.1 E row: "全部未命中").
E_FALLBACK_RULE = "E-fallback"

#: Same fallback when the caller registered no rule set at all - the engine still
#: must not raise (07 §四 keeps a cycle going; §8.1 E is the catch-all).
NO_RULES_NOTE = "no classify rules registered; treated as 07 §8.1 E fallback"

#: Why the terminal E fallback fired (07 §8.1 E row: "其他兜底 | 全部未命中").
E_FALLBACK_NOTE = "no B/C/D/A rule hit (07 §8.1 E row)"

#: Confidence labels written into ``ClassifiedPost.note``. ``high`` = the rule hit
#: with 0 measured false positives on the 02 corpus; ``low`` = the rule is flagged
#: ``low_confidence`` and the integrator queues it for a human (07 §5.1 P0-9).
CONFIDENCE_HIGH = "high"
CONFIDENCE_LOW = "low"


class RuleEngine(Classifier):
    """Ordered rule evaluation over a registered ``ClassifyRule`` list."""

    def __init__(self, cfg=None, rules: Iterable[ClassifyRule] = ()):
        #: ``cfg.enable_account_farm`` (P2, default off) is the only knob the
        #: engine itself needs; the rule set is registered by ``main``.
        self.cfg = cfg
        self._rules: List[ClassifyRule] = []
        self.register(rules)

    @property
    def rules(self) -> List[ClassifyRule]:
        """The evaluated order (read-only view, for tests and the report)."""
        return list(self._rules)

    def register(self, rules: Iterable[ClassifyRule]) -> None:
        """Append rules (source-specific ones arrive here via the adapter, D10).

        Re-sorts by ``priority`` with a **stable** sort, so rules sharing a
        priority keep their registration order - that is what makes badge beat
        keyword inside D, and A1 beat A2 beat A3 inside A, without the engine
        knowing anything about linux.sb (07 §8.1 规则分层).

        Idempotent by rule name: ``main.run_cycle`` re-registers every cycle and
        a duplicate rule would double-count ``replay()``.
        """
        for rule in rules:
            if any(existing.name == rule.name for existing in self._rules):
                continue
            self._rules.append(rule)
        self._rules.sort(key=lambda r: r.priority)

    def classify(self, post: FullPost) -> ClassifiedPost:
        """Evaluate in B -> C -> D -> A order, stop at first hit, else E.

        Contract (07 8.1):
          * B: :mod:`rules_common` credential check (``sk-[A-Za-z0-9_-]{20,}``
            family) - 11/100 in forum 2, 0/100 in forum 8, 0 false positives;
          * C: ``\\[回复可见\\]|回复后可见|回复本主题后即可查看`` - 6/0. **``🔒`` alone is
            NOT a signal**: the loose variant dropped precision to 86% (tid 23165
            used the emoji as a bullet). The DOM marker
            ``nb-editor-reply-visible-locked`` is the per-post cross-check
            (4/4 vs 0 for controls) and is already surfaced as
            ``FullPost.reply_visible_locked``;
          * D: badge first (``.virtual-card-box`` / ``virtual-card-title-status``
            with 发卡中 / 发卡结束), keyword fallback ``兑换|积分|发卡|卡密|CDK``.
            Disposition is 07 8.1 verbatim: in-site paid content is not free -
            record title + link + price as 福利情报 only, **no extraction, no probe**
            (``card_or_paid_benefit_info``);
          * A: A1 | A2 | A3 union;
          * E: fallback, 52/100 forum 2, 30/100 forum 8 - must exist, and
            suspected-valuable E posts go to the manual queue.

        Never use reply/view counters or an author whitelist as a signal
        (07 8.1 "必须剔除的误报源": counters broke after 09-20; 72 authors in 100
        posts, top 5 only 19%).
        """
        for rule in self._rules:
            if rule.applies(post):
                confidence = CONFIDENCE_LOW if rule.low_confidence else CONFIDENCE_HIGH
                return ClassifiedPost(
                    post=post,
                    category=rule.category,
                    matched_rule=rule.name,
                    low_confidence=rule.low_confidence,
                    note=f"confidence={confidence}; {rule.why}",
                )
        #: Nothing hit. A registered E-class rule would have caught this, so
        #: reaching here means the caller's rule set has no E entry at all.
        note = E_FALLBACK_NOTE if self._rules else NO_RULES_NOTE
        return ClassifiedPost(
            post=post,
            category=CATEGORY_E,
            matched_rule=E_FALLBACK_RULE,
            low_confidence=False,
            note=f"confidence={CONFIDENCE_HIGH}; {note}",
        )

    def replay(self, posts: Iterable[FullPost]) -> dict:
        """Return ``{category: hit_count}`` for the 07 §8.1 acceptance replay.

        P0-4 verification expects forum 2: B=11, C=6, D=16, A=21, E=52.

        Keys are always the full ``CATEGORIES`` set, so a rule that stopped
        firing shows up as a visible zero instead of a missing key. The
        per-rule and needs-review breakdowns are in :meth:`replay_detail`.
        """
        counts = {category: 0 for category in CATEGORIES}
        for item in (self.classify(post) for post in posts):
            counts[item.category] += 1
        return counts

    def replay_detail(self, posts: Iterable[FullPost]) -> dict:
        """Same corpus as :meth:`replay`, broken down further.

        ``{"total": n, "categories": {...}, "rules": {name: n}, "review": n}`` -
        ``review`` counts the posts whose result carries the needs-review flag
        (``ClassifiedPost.low_confidence``), which is what 07 §5.1 P0-9 files in
        ``manual_queue``. The daily report (P0-8) consumes this shape.
        """
        rules: Dict[str, int] = {}
        categories = {category: 0 for category in CATEGORIES}
        review = 0
        total = 0
        for post in posts:
            item = self.classify(post)
            total += 1
            categories[item.category] += 1
            rules[item.matched_rule] = rules.get(item.matched_rule, 0) + 1
            if item.low_confidence:
                review += 1
        return {"total": total, "categories": categories, "rules": rules, "review": review}

