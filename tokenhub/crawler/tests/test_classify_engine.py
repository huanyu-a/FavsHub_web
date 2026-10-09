"""Rule-engine tests for ``classify/engine.py`` (07 §8.1 order B -> C -> D -> A -> E).

Covers the ordering guarantees the contract makes with *data* (priority), the
needs-review routing (``ClassifiedPost.low_confidence`` is the flag the integrator
files in ``manual_queue`` - ARCHITECTURE.md §5), the confidence triple the task
asks the classifier to output (category + matched rule + confidence - the last as
``low_confidence`` plus the ``confidence=high|low`` label in ``note``), and the
two boundary posts 07 §8.1
names: tid 23295 (credential inside a reply gate -> B) and tid 23165 (the lock
emoji used as a bullet -> must not be C).

Self-sufficient: dataclasses only, no network, no ``crawler/data/``, no real key.
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import interfaces  # noqa: E402
from fixtures import load  # noqa: E402
from interfaces import (  # noqa: E402
    CATEGORY_A,
    CATEGORY_B,
    CATEGORY_C,
    CATEGORY_D,
    CATEGORY_E,
    PRIORITY_A,
    PRIORITY_B,
    PRIORITY_C,
    PRIORITY_D,
    PRIORITY_E,
    ClassifyRule,
    FullPost,
    RawPost,
)
from classify.engine import E_FALLBACK_RULE, RuleEngine  # noqa: E402
from classify.rules_common import common_rules  # noqa: E402
from classify.rules_linux_sb import linux_sb_rules  # noqa: E402

FAKE_KEY = "sk-TESTFAKEa1b2c3d4e5f6g7h8i9j0"


def post(body="", title="", locked=False, card=False, enriched=True,
         author="tester", views=0, replies=0, likes=0, tid=1):
    raw = RawPost(
        tid=tid, title=title, forum_id=2, forum_name="福利放送", author_name=author,
        url=f"https://linux.sb/topic/{tid}", content_text="" if enriched else body,
        post_time="", views_count=views, replies_count=replies, likes_count=likes,
    )
    return FullPost(raw=raw, article_body=body if enriched else "",
                    reply_visible_locked=locked, virtual_card=card, enriched=enriched)


def engine() -> RuleEngine:
    """A fully wired engine: generic set + linux.sb set, as ``main.run_cycle``
    registers them (main.py:203)."""
    eng = RuleEngine(None)
    eng.register(list(common_rules()) + list(linux_sb_rules()))
    return eng


class RegistrationTests(unittest.TestCase):
    def test_register_sorts_by_priority(self):
        eng = RuleEngine(None)
        #: Registered deliberately backwards; the effective order must still be
        #: B(0) -> C(1) -> D(2) -> A(3) -> E(4) (ARCHITECTURE.md §3.1).
        eng.register(list(reversed(linux_sb_rules())) + list(reversed(common_rules())))
        self.assertEqual([r.priority for r in eng.rules],
                         [PRIORITY_B, PRIORITY_C, PRIORITY_D, PRIORITY_D,
                          PRIORITY_A, PRIORITY_A, PRIORITY_A, PRIORITY_E])

    def test_priority_ties_keep_registration_order(self):
        #: ``sorted`` is stable, so A1 is tried before A2/A3 and D-badge before
        #: D-keyword even though both pairs share a priority.
        eng = engine()
        self.assertEqual([r.name for r in eng.rules if r.priority == PRIORITY_A],
                         ["A1", "A2", "A3"])
        self.assertEqual([r.name for r in eng.rules if r.priority == PRIORITY_D],
                         ["D-badge", "D-keyword"])

    def test_register_is_idempotent(self):
        #: ``main.run_cycle`` calls register() every cycle on the same instance.
        eng = engine()
        first = len(eng.rules)
        eng.register(list(common_rules()) + list(linux_sb_rules()))
        self.assertEqual(len(eng.rules), first)

    def test_custom_rules_are_accepted(self):
        marker = []

        def applies(p):
            marker.append(p.tid)
            return False

        eng = RuleEngine(None, [ClassifyRule(name="noop", category=CATEGORY_B,
                                             priority=PRIORITY_B, applies=applies)])
        eng.register(common_rules())
        self.assertEqual(eng.classify(post(body="普通帖子")).category, CATEGORY_E)
        self.assertEqual(marker, [1])


class OrderingTests(unittest.TestCase):
    def test_b_wins_over_c_inside_the_gate(self):
        #: 07 §8.1 heading: B 优先于 C - tid 23295 证明 gate 内可能直接有凭证.
        #: fixtures/linux_sb_credentials_d6.json "expected.category" = "B".
        leak = load("linux_sb_credentials_d6")["reply_visible_leak_fake"]
        self.assertIn("[回复可见]", leak)
        item = engine().classify(post(body=leak, title="新集 全国模 无限速"))
        self.assertEqual(item.category, CATEGORY_B)
        self.assertEqual(item.matched_rule, "B")

    def test_b_wins_when_the_dom_lock_is_also_present(self):
        item = engine().classify(post(body="公开可用 " + FAKE_KEY, locked=True))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_B, "B"))

    def test_b_wins_over_d_keyword(self):
        item = engine().classify(post(body=f"积分兑换活动 送 {FAKE_KEY}"))
        self.assertEqual(item.category, CATEGORY_B)

    def test_b_wins_over_a3(self):
        #: 02 §D.7 measures A∩B=1 in forum 2 - one post matches both.
        item = engine().classify(post(body=f"注册送额度 {FAKE_KEY}"))
        self.assertEqual(item.category, CATEGORY_B)

    def test_c_wins_over_d_and_a(self):
        #: 02 §D.7: A∩C=0, C∩D=0 in the sample, but the order must still hold.
        item = engine().classify(post(body="回复后可见 https://x.cn/?aff=zz 积分", card=True))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_C, "C"))

    def test_d_badge_wins_over_a(self):
        #: Badge outranks the keyword (07 §8.1 D row) and D outranks A.
        item = engine().classify(post(body="邀请码 https://x.cn/?aff=zz", card=True))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_D, "D-badge"))

    def test_a_wins_over_e(self):
        item = engine().classify(post(body="福利中转站 https://x.cn/register"))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_A, "A1"))

    def test_full_chain_order_is_b_c_d_a_e(self):
        #: One post per class, each also carrying every weaker signal.
        corpus = {
            "B": post(body=FAKE_KEY + " 回复可见 积分 推广 ?aff=1", locked=True, card=True),
            "C": post(body="[回复可见] 积分 推广 ?aff=1", card=True),
            "D": post(body="积分 推广 ?aff=1", card=True),
            "A": post(body="推广 ?aff=1"),
            "E": post(body="今天聊点别的"),
        }
        self.assertEqual([engine().classify(p).category for p in corpus.values()],
                         ["B", "C", "D", "A", "E"])
        self.assertEqual([PRIORITY_B, PRIORITY_C, PRIORITY_D, PRIORITY_A, PRIORITY_E],
                         [0, 1, 2, 3, 4])

    def test_engine_stops_at_first_hit(self):
        calls = []

        def spy(name):
            def applies(p):
                calls.append(name)
                return False
            return applies

        eng = RuleEngine(None, common_rules())
        #: A trailing always-no rule at a lower priority must still be reached,
        #: but a weaker one after a hit must not.
        eng.register([ClassifyRule(name="probe", category=CATEGORY_E, priority=PRIORITY_E,
                                   applies=spy("probe"))])
        eng.classify(post(body=FAKE_KEY))
        self.assertEqual(calls, [], calls)

    def test_classification_without_any_rule_falls_back_to_e(self):
        eng = RuleEngine(None)
        item = eng.classify(post(body="随便写点什么"))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_E, E_FALLBACK_RULE))
        self.assertFalse(item.low_confidence)


class NeedsReviewFlagTests(unittest.TestCase):
    """``low_confidence`` IS the needs-review flag the integrator files in
    ``manual_queue`` (ARCHITECTURE.md §5, main.py:209-217)."""

    def test_d_keyword_hit_needs_review(self):
        #: 02 §D.7: 积分 also occurs in lottery posts (A∩D=4) -> low confidence.
        item = engine().classify(post(body="攒积分兑换一个皮肤"))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_D, "D-keyword"))
        self.assertTrue(item.low_confidence)
        self.assertIn("card_or_paid_benefit_info", item.note)

    def test_d_badge_hit_is_high_confidence_but_still_record_only(self):
        #: 07 §8.1: 站内付费不是白嫖 -> 只记录，不提取不探测.
        item = engine().classify(post(body="库存不多了", card=True))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_D, "D-badge"))
        self.assertFalse(item.low_confidence)
        self.assertIn("NO extraction/probe", item.note)

    def test_suspected_value_e_needs_review(self):
        #: 07 §8.1 E row: 疑似有价值的进人工队列.
        item = engine().classify(post(body="发现一个公益中转站，额度无限"))
        self.assertEqual(item.category, CATEGORY_E)
        self.assertEqual(item.matched_rule, "E-suspected-value")
        self.assertTrue(item.low_confidence)
        self.assertIn("suspected_valuable_E", item.note)

    def test_plain_e_is_not_flagged(self):
        item = engine().classify(post(body="有人知道这个报错怎么解决吗"))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_E, E_FALLBACK_RULE))
        self.assertFalse(item.low_confidence)

    def test_high_precision_classes_are_not_flagged(self):
        #: 07 §8.1 misjudge column: B 0 false, C 0 false, A1 极可靠/0 误判.
        for body, want in ((FAKE_KEY, "B"), ("[回复可见]", "C"),
                           ("https://x.cn/?aff=zz", "A1")):
            item = engine().classify(post(body=body))
            with self.subTest(body=body):
                self.assertEqual(item.matched_rule, want)
                self.assertFalse(item.low_confidence)


class OutputContractTests(unittest.TestCase):
    def test_output_triple_category_rule_confidence(self):
        #: The task asks for 类别 + 命中规则名 + 置信度.
        eng = engine()
        expected = {
            FAKE_KEY: (CATEGORY_B, "B", "high"),
            "[回复可见]": (CATEGORY_C, "C", "high"),
            "攒积分兑换": (CATEGORY_D, "D-keyword", "low"),
            "https://x.cn/?aff=zz": (CATEGORY_A, "A1", "high"),
            "随便聊": (CATEGORY_E, E_FALLBACK_RULE, "high"),
        }
        for body, (cat, rule, conf) in expected.items():
            item = eng.classify(post(body=body))
            with self.subTest(body=body):
                self.assertEqual(item.category, cat)
                self.assertEqual(item.matched_rule, rule)
                self.assertEqual(conf, "low" if item.low_confidence else "high")
                self.assertIn(f"confidence={conf}", item.note)

    def test_note_carries_the_rule_why_and_the_confidence(self):
        #: ``ClassifyRule.why`` is recorded into ``ClassifiedPost.note`` (see
        #: interfaces.py:236-237) together with the confidence label.
        eng = engine()
        by_name = {r.name: r for r in eng.rules}
        for body, name in ((FAKE_KEY, "B"), ("[回复可见]", "C"),
                           ("https://x.cn/?aff=zz", "A1"), ("攒积分兑换", "D-keyword")):
            item = eng.classify(post(body=body))
            with self.subTest(rule=name):
                self.assertEqual(item.matched_rule, name)
                self.assertIn(by_name[name].why, item.note)
                self.assertIn("confidence=" + ("low" if item.low_confidence else "high"),
                              item.note)


    def test_classified_post_keeps_the_source_post(self):
        p = post(body=FAKE_KEY, tid=23295)
        item = engine().classify(p)
        self.assertIs(item.post, p)
        self.assertEqual(item.post.tid, 23295)

    def test_matched_rule_is_never_empty(self):
        eng = engine()
        for body in ("", "RT", "普通", FAKE_KEY, "积分", "[回复可见]", "?aff=1", "福利"):
            self.assertTrue(eng.classify(post(body=body)).matched_rule, body)


class BoundaryPostTests(unittest.TestCase):
    def test_tid_23165_lock_emoji_is_not_c(self):
        #: 07 §8.1 C row: 不要把 🔒 单独算信号（宽松版精确率降到 86%），tid 23165
        #: used it as a bullet. So this post must NOT be C.
        body = "🔒 修复了一个小问题 🔒 优化了性能 🔒 增加了日志"
        item = engine().classify(post(body=body, tid=23165))
        self.assertNotEqual(item.category, CATEGORY_C)
        self.assertEqual(item.category, CATEGORY_E)

    def test_tid_23295_gate_with_key_is_b_not_c(self):
        fx = load("linux_sb_credentials_d6")
        self.assertEqual(fx["expected"]["category"], CATEGORY_B)
        self.assertEqual(fx["samples"][2]["tid"], 23295)
        item = engine().classify(post(body=fx["reply_visible_leak_fake"], tid=23295))
        self.assertEqual(item.category, CATEGORY_B)

    def test_fixture_23217_is_c(self):
        fx = load("linux_sb_23217")
        item = engine().classify(post(body=fx["article_body_tail"], title=fx["title"],
                                      locked=fx["reply_visible_locked"], tid=fx["tid"]))
        self.assertEqual((item.category, item.matched_rule),
                         (fx["expected"]["category"], fx["expected"]["matched_rule"]))
        self.assertFalse(item.low_confidence)

    def test_fixture_virtual_card_is_d(self):
        fx = load("linux_sb_virtual_card")
        #: FullPost carries the sniffed badge flag (07 §5.1 P0-3), the price box is
        #: the HTML-level payload.
        item = engine().classify(post(body="积分兑换 库存不多了", card=True, tid=fx["tid"]))
        self.assertEqual(item.category, CATEGORY_D)
        self.assertEqual(fx["expected"]["matched_rule"], "D-badge")
        self.assertEqual(fx["expected"]["manual_reason"], "card_or_paid_benefit_info")

    def test_empty_body_uses_the_title(self):
        #: 02 §D.9: 2 条板块 8 正文为空、3 条板块 2 正文为 RT -> 必须靠标题兜底.
        item = engine().classify(post(body="", title="超低价claude-opus-46中转 ?aff=abcd"))
        self.assertEqual((item.category, item.matched_rule), (CATEGORY_A, "A1"))

    def test_rt_body_uses_the_title(self):
        item = engine().classify(post(body="RT", title="注册送 20 额度"))
        self.assertEqual(item.category, CATEGORY_A)

    def test_real_body_beats_a_promotional_title(self):
        #: The title is a fallback, not an extra signal: a body with its own content
        #: must not be dragged into A by the title alone.
        item = engine().classify(post(body="今天讨论一下内核调度", title="注册送额度"))
        self.assertEqual(item.category, CATEGORY_E)

    def test_degraded_enrichment_still_classifies(self):
        #: enriched=False -> FullPost.text is the truncated aggregator copy (§P0-3).
        item = engine().classify(post(body="回复后可见", enriched=False))
        self.assertEqual(item.category, CATEGORY_C)


class ReplayTests(unittest.TestCase):
    def test_replay_counts_categories(self):
        eng = engine()
        corpus = (
            [post(body=FAKE_KEY, tid=i) for i in range(11)]          # B=11
            + [post(body="回复后可见", tid=100 + i) for i in range(6)]   # C=6
            + [post(body="积分兑换", card=True, tid=200 + i) for i in range(16)]  # D=16
            + [post(body="https://x.cn/?aff=zz", tid=300 + i) for i in range(21)]  # A=21
            + [post(body="闲聊帖", tid=400 + i) for i in range(46)]
            + [post(body="公益中转站额度", tid=500 + i) for i in range(6)]  # E-suspected
        )
        counts = eng.replay(corpus)
        #: 07 §8.1 forum-2 measured distribution: B=11, C=6, D=16, A=21, E=52.
        self.assertEqual(counts, {CATEGORY_B: 11, CATEGORY_C: 6, CATEGORY_D: 16,
                                  CATEGORY_A: 21, CATEGORY_E: 52})
        self.assertEqual(sum(counts.values()), len(corpus))

    def test_replay_includes_review_counts(self):
        eng = engine()
        detail = eng.replay_detail([post(body="攒积分", tid=1),
                                       post(body="闲聊", tid=2)])
        self.assertEqual(detail["total"], 2)
        self.assertEqual(detail["review"], 1)
        self.assertEqual(detail["rules"]["D-keyword"], 1)

    def test_replay_on_empty_input(self):
        self.assertEqual(engine().replay([]), {c: 0 for c in interfaces.CATEGORIES})


class BannedSignalBehaviourTests(unittest.TestCase):
    """07 §8.1 必须剔除的误报源 - behavioural half of the guard."""

    def test_counters_do_not_change_the_answer(self):
        #: counters broke after 09-20 (02 §D.7), so they can never be a signal.
        a = post(body="公益中转站额度无限", views=99999, replies=500, likes=300, tid=1)
        b = post(body="公益中转站额度无限", views=0, replies=0, likes=0, tid=2)
        self.assertEqual((a.raw.views_count, b.raw.views_count), (99999, 0))
        self.assertEqual(
            (engine().classify(a).category, engine().classify(b).category),
            (engine().classify(b).category, engine().classify(a).category))
        self.assertEqual(engine().classify(a).category, CATEGORY_E)
        self.assertEqual(engine().classify(b).matched_rule, "E-suspected-value")

    def test_author_identity_does_not_change_the_answer(self):
        #: 72 authors / 100 posts, Top5 19% (02 §D.7) -> no whitelist signal.
        hot = post(body="求助：这个报错怎么解决", author="big_name_sharer", tid=1)
        new = post(body="求助：这个报错怎么解决", author="nobody_new", tid=2)
        self.assertEqual(engine().classify(hot).matched_rule,
                         engine().classify(new).matched_rule)
        self.assertEqual(engine().classify(hot).category, CATEGORY_E)

    def test_all_caps_affiliate_id_is_not_a_signal(self):
        #: The 32+ all-caps alnum run scored precision 0/3 (all affiliate IDs).
        item = engine().classify(post(body="ref ABCDEFGHJKLMNPQRSTUVWXYZ01234567 down"))
        self.assertEqual(item.category, CATEGORY_E)


if __name__ == "__main__":
    unittest.main()
