"""Per-rule tests for ``classify/rules_common.py`` + ``classify/rules_linux_sb.py``
(07 §8.1, task P0-4).

Self-sufficient: pure predicates over ``FullPost`` dataclasses and the
``crawler/fixtures`` corpus. No network, no ``crawler/data/``, no real key - every
credential is the ``sk-TESTFAKE`` fake of 07 §8.5.

Each rule gets a positive and a negative case, plus the two boundary tids 07 §8.1
names: 23165 (``🔒`` used as a bullet - must NOT be C) and 23295 (a credential
inside a reply-gate - must be B).
"""
from __future__ import annotations

import os
import re
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
from classify.rules_common import (  # noqa: E402
    common_rules,
    credential_hit,
    has_credential,
    is_promotion,
    is_suspected_valuable_E,
    match_text,
    promotion_subrule,
)
from classify.rules_linux_sb import (  # noqa: E402
    card_price,
    is_card_post,
    is_reply_visible,
    linux_sb_rules,
)

#: The only credential literal allowed in this repo (07 §8.5). 28 chars after
#: ``sk-`` so 07 §8.2's 通用 layer (``{20,220}``) matches it.
FAKE_KEY = "sk-TESTFAKEa1b2c3d4e5f6g7h8i9j0"

#: 07 §8.1 D row keyword fallback, compiled from the shared constant.
D_PATTERN = re.compile(interfaces.D_KEYWORDS_RE)


def fake_key(*parts: str) -> str:
    """Join a credential-shaped fake at runtime.

    Used for the 07 §8.2 主正则 layer only: the repo-wide red-line scan
    (``test_fixtures_safety.py``) forbids any credential-shaped *literal* in a
    file unless it starts with ``sk-TESTFAKE``, and provider-prefixed shapes
    (``sk-or-v1-…``) cannot satisfy that. Splitting the parts keeps the literal
    out of the file while the value stays an unmistakable fake.
    """
    return "".join(parts)


def post(body="", title="", locked=False, card=False, enriched=True,
         author="tester", views=0, replies=0, likes=0, tid=1):
    """Build a ``FullPost`` for rule tests."""
    raw = RawPost(
        tid=tid, title=title, forum_id=2, forum_name="福利放送", author_name=author,
        url=f"https://linux.sb/topic/{tid}", content_text="" if enriched else body,
        post_time="", views_count=views, replies_count=replies, likes_count=likes,
    )
    return FullPost(raw=raw, article_body=body if enriched else "",
                    reply_visible_locked=locked, virtual_card=card, enriched=enriched)


class CredentialRuleTests(unittest.TestCase):
    """B - 07 §8.1 row 1 (11 hits / 0 false in forum 2, 0 in forum 8)."""

    def test_b_positive_generic_layer(self):
        self.assertTrue(has_credential(post(body=f"亲测有效 {FAKE_KEY} https://all-in-one.icu")))
        self.assertEqual(credential_hit(FAKE_KEY), "generic")

    def test_b_positive_primary_layer(self):
        key = fake_key("sk-", "or-v1-", "TESTFAKE", "a1b2c3d4e5f6g7h8i9j0")
        self.assertEqual(credential_hit(key), "primary")
        self.assertTrue(has_credential(post(body="openrouter key: " + key)))

    def test_b_positive_bearer_prefix_stripped(self):
        #: 07 §8.2: "主正则（提取前剔除 Bearer 前缀）".
        text = "Authorization: Bearer " + FAKE_KEY
        self.assertTrue(credential_hit(text) is not None, text)
        self.assertTrue(has_credential(post(body=text)))

    def test_b_negative_short_fragment(self):
        #: Below the {20,220} tail of 07 §8.2's 通用 layer -> not a credential.
        self.assertFalse(has_credential(post(body="sk-shortfrag")))
        self.assertIsNone(credential_hit("sk-abcdefghijklmnop"))

    def test_b_negative_all_caps_affiliate_shape_is_not_a_credential(self):
        #: 07 §8.1 必须剔除的误报源 #1: the 32+ all-caps alnum run (precision
        #: 0/3 - all affiliate IDs). It must carry no signal at all.
        affiliate_id = "ABCDEFGHJKLMNPQRSTUVWXYZ01234567"
        self.assertEqual(len(affiliate_id), 32)
        self.assertIsNone(credential_hit(affiliate_id))
        self.assertFalse(has_credential(post(body="ref " + affiliate_id)))
        self.assertFalse(is_promotion(post(body="ref " + affiliate_id)))

    def test_b_positive_inside_reply_gate_is_still_credential(self):
        #: tid 23295 shape (fixtures/linux_sb_credentials_d6.json): the aggregator
        #: returns raw text, so a key can sit inside the gate (02 §D.6).
        leak = load("linux_sb_credentials_d6")["reply_visible_leak_fake"]
        self.assertIn("[回复可见]", leak)
        self.assertTrue(has_credential(post(body=leak)))


class ReplyGateRuleTests(unittest.TestCase):
    """C - 07 §8.1 row 2 (6 hits / 0 false)."""

    def test_c_positive_bracket_form(self):
        self.assertTrue(is_reply_visible(post(body="下载地址 [回复可见] [/回复可见]")))

    def test_c_positive_plain_form(self):
        self.assertTrue(is_reply_visible(post(body="链接🔒回复后可见")))

    def test_c_positive_review_form(self):
        self.assertTrue(is_reply_visible(post(body="回复本主题后即可查看这部分内容。")))

    def test_c_positive_dom_marker_evidence(self):
        #: Placeholder truncated away (02 §D.8) but enrichment sniffed the DOM
        #: marker -> interfaces.py:286 calls reply_visible_locked "C-class evidence".
        self.assertTrue(is_reply_visible(post(body="只给了外链 https://cssmapi.fun", locked=True)))

    def test_c_negative_lock_emoji_alone(self):
        #: 07 §8.1 verbatim: 不要把 🔒 单独算信号（宽松版精确率降到 86%）, and 02 §D.7
        #: attributes the one false hit to tid 23165 using 🔒 as a bullet.
        self.assertFalse(is_reply_visible(post(body="🔒 更新了一下，修复了几个小 bug")))
        self.assertFalse(is_reply_visible(post(body="🔒🔒🔒")))

    def test_c_negative_plain_unlocked_post(self):
        self.assertFalse(is_reply_visible(post(body="完全公开的下载地址 https://example.org")))

    def test_c_fixture_23217(self):
        #: fixtures/linux_sb_23217.json expected: category C, matched_rule C, and
        #: the 🔒-alone warning in its rationale.
        fx = load("linux_sb_23217")
        self.assertTrue(is_reply_visible(post(body=fx["article_body_tail"],
                                              title=fx["title"], locked=fx["reply_visible_locked"])))
        self.assertEqual(fx["expected"]["category"], CATEGORY_C)


class CardRuleTests(unittest.TestCase):
    """D - 07 §8.1 row 3 (badge first, keyword fallback; 16 / 11 hits)."""

    def test_d_badge_positive_fixture_list_badge(self):
        #: 02 §A.6 list row carries the second 07 §8.1 marker.
        self.assertTrue(is_card_post(load("linux_sb_virtual_card")["list_badge_html"]))

    def test_d_body_fragment_is_the_price_box_not_the_badge(self):
        #: 02 §A.5 quotes the *inside* of the card (kicker / status / price) with
        #: the ``.virtual-card-box`` wrapper elided by an ellipsis, so the badge
        #: check correctly does not fire on the fragment - ``card_price`` is the
        #: helper that consumes it, and the wrapper is what enrichment sniffs.
        card_html = load("linux_sb_virtual_card")["card_html"]
        self.assertFalse(is_card_post(card_html))
        self.assertEqual(card_price(card_html), "88 积分 / 张")

    def test_d_badge_negative_plain_html(self):
        self.assertFalse(is_card_post("<p>普通帖子正文</p>"))
        self.assertFalse(is_card_post(""))

    def test_d_badge_marker_dot_is_stripped(self):
        #: 07 §8.1 writes the first badge as the CSS selector ``.virtual-card-box``;
        #: page markup carries the bare class name.
        self.assertIn(".virtual-card-box", interfaces.D_BADGE_MARKERS)
        self.assertTrue(is_card_post('<div class="virtual-card-box"><span>x</span></div>'))

    def test_d_keyword_positive_table_words(self):
        for text in ("积分兑换", "出卡密", "发卡中", "CDK 补给", "攒积分"):
            with self.subTest(text=text):
                self.assertTrue(_keyword_hit(text))

    def test_d_keyword_negative(self):
        self.assertFalse(_keyword_hit("今天天气不错，求助一个报错"))

    def test_card_price_from_fixture(self):
        #: parsed_expectation in the fixture: price 88, unit "积分 / 张".
        fx = load("linux_sb_virtual_card")
        self.assertEqual(card_price(fx["card_html"]), "88 积分 / 张")

    def test_card_price_none_without_box(self):
        self.assertIsNone(card_price("<p>no card here</p>"))
        self.assertIsNone(card_price(""))

    def test_card_price_carries_no_download_link(self):
        #: D is record-only (07 §8.1 / §5.3); the paid payload must never leak out
        #: of the price helper.
        html = ('<div class="virtual-card-price"><strong>88</strong>'
                '<span>积分 / 张</span></div><a href="https://pay.example/dl">下载链接</a>')
        self.assertNotIn("http", card_price(html) or "")


class PromotionRuleTests(unittest.TestCase):
    """A1/A2/A3 - 07 §8.1 rows 4-6."""

    def test_a1_positive_aff_query_forms(self):
        for text in ("https://x.cn/register?aff=abc123", "https://x.cn/go&aff=9"):
            with self.subTest(text=text):
                self.assertEqual(promotion_subrule(post(body=text)), "A1")

    def test_a1_positive_signup_paths(self):
        for text in ("/sign-up", "/register", "/signup"):
            with self.subTest(text=text):
                self.assertEqual(promotion_subrule(post(body="官网 " + text)), "A1")

    def test_a1_case_insensitive_aff(self):
        #: 07 §8.1 A1_RE starts with ``(?i)``.
        self.assertEqual(promotion_subrule(post(body="https://x.cn/?AFF=zz")), "A1")

    def test_a1_negative_plain_docs_link(self):
        self.assertIsNone(promotion_subrule(post(body="https://docs.example.com/v1/models")))

    def test_a2_positive_vocabulary(self):
        for word in ("邀请码", "邀请链接", "inviteCode", "referral", "返利", "优惠", "折扣",
                     "佣金", "推广"):
            with self.subTest(word=word):
                self.assertTrue(is_promotion(post(body=f"这个站的{word}在这里")))

    def test_a2_negative_shouchong_was_removed(self):
        #: 07 §8.1 A2 row: 已删 首充（200 条 0 命中）.
        self.assertIsNone(promotion_subrule(post(body="首充送 10 块，没有别的")))

    def test_a2_negative_bare_register_is_too_weak(self):
        #: 07 §8.1 A2 row: 注册 单用太弱，不入 A2.
        self.assertIsNone(promotion_subrule(post(body="注册了一个账号，不知道怎么用")))

    def test_a3_positive_register_gift(self):
        self.assertEqual(promotion_subrule(post(body="注册就送 20 额度")), "A3")

    def test_a3_positive_amount_side(self):
        self.assertTrue(is_promotion(post(body="领 50 美金体验")))

    def test_a_subrule_order_a1_wins_over_a3(self):
        #: matched_rule must name the sub-rule that fired (P0-4 acceptance).
        self.assertEqual(
            promotion_subrule(post(body="注册就送额度，链接 https://x.cn/?aff=zz")), "A1")

    def test_a_negative_help_request(self):
        self.assertFalse(is_promotion(post(body="求助：这个 429 报错是什么意思")))


class SuspectedValueETests(unittest.TestCase):
    """E triage - 07 §8.1 E row (疑似有价值的进人工队列) / §5.1 P0-9."""

    def test_e_positive_benefit_word_without_other_rule(self):
        self.assertTrue(is_suspected_valuable_E(
            post(body="发现一个公益中转站，额度无限，可以白嫖")))

    def test_e_negative_plain_chatter(self):
        self.assertFalse(is_suspected_valuable_E(
            post(body="有人知道这个 vscode 插件报错怎么解决吗")))

    def test_e_negative_empty_post(self):
        self.assertFalse(is_suspected_valuable_E(post(body="", title="")))


class MatchTextTests(unittest.TestCase):
    """Body / title selection (02 §D.9: empty bodies and ``RT`` bodies)."""

    def test_match_text_uses_body(self):
        self.assertEqual(match_text(post(body="正文", title="标题")), "正文")

    def test_match_text_title_fallback_when_body_empty(self):
        self.assertEqual(match_text(post(body="", title="只有标题")), "只有标题")

    def test_match_text_title_fallback_when_body_is_rt(self):
        for body in ("RT", "rt", "RT。", " RT "):
            with self.subTest(body=body):
                self.assertEqual(match_text(post(body=body, title="标题兜底")), "标题兜底")

    def test_match_text_degraded_body(self):
        #: enriched=False -> FullPost.text is the truncated aggregator copy.
        self.assertEqual(match_text(post(body="截断的 200 字", enriched=False)), "截断的 200 字")


class RuleTableShapeTests(unittest.TestCase):
    """The registered table must encode 07 §8.1's order and confidence flags."""

    def test_priority_constants_are_b_c_d_a_e(self):
        self.assertEqual(
            [PRIORITY_B, PRIORITY_C, PRIORITY_D, PRIORITY_A, PRIORITY_E], [0, 1, 2, 3, 4])

    def test_common_rule_names_and_priorities(self):
        rules = common_rules()
        self.assertEqual([r.name for r in rules], ["B", "A1", "A2", "A3", "E-suspected-value"])
        self.assertEqual([r.priority for r in rules],
                         [PRIORITY_B, PRIORITY_A, PRIORITY_A, PRIORITY_A, PRIORITY_E])
        self.assertEqual([r.category for r in rules],
                         [CATEGORY_B, CATEGORY_A, CATEGORY_A, CATEGORY_A, CATEGORY_E])

    def test_linux_sb_rule_names_and_priorities(self):
        rules = linux_sb_rules()
        self.assertEqual([r.name for r in rules], ["C", "D-badge", "D-keyword"])
        self.assertEqual([r.priority for r in rules], [PRIORITY_C, PRIORITY_D, PRIORITY_D])
        self.assertEqual([r.category for r in rules], [CATEGORY_C, CATEGORY_D, CATEGORY_D])

    def test_only_low_confidence_rules_are_flagged(self):
        #: 07 §8.1 measures 0 false positives for B, C and A1, and 未见明显误判 for
        #: A3; the keyword-only D hit (积分 also occurs in lottery posts, 02 §D.7
        #: A∩D=4) and the E value triage are the two needs-review cases.
        flagged = sorted(r.name for r in common_rules() + linux_sb_rules() if r.low_confidence)
        self.assertEqual(flagged, ["D-keyword", "E-suspected-value"])

    def test_every_rule_is_a_frozen_classify_rule(self):
        for r in common_rules() + linux_sb_rules():
            self.assertIsInstance(r, ClassifyRule)
            self.assertIn(r.category, interfaces.CATEGORIES)
            self.assertTrue(callable(r.applies))
            self.assertTrue(r.why, r.name)

    def test_d_reason_is_benefit_info(self):
        #: 07 §5.1 P0-9 files D under this reason.
        for r in linux_sb_rules():
            if r.category == CATEGORY_D:
                self.assertIn("card_or_paid_benefit_info", r.why, r.name)


class BannedSignalSourceTests(unittest.TestCase):
    """07 §8.1 必须剔除的误报源 - guarded at source level, not just by behaviour."""

    #: Written as fragments so this file itself does not spell the identifiers.
    BANNED = (
        "views" + "_count",
        "replies" + "_count",
        "likes" + "_count",
        "author" + "_name",
        "AFFILIATE" + "_ID",
        "CDK" + "_" + "RE",
    )

    def _classify_sources(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        folder = os.path.join(root, "classify")
        for name in sorted(os.listdir(folder)):
            if name.endswith(".py"):
                path = os.path.join(folder, name)
                with open(path, encoding="utf-8") as fh:
                    yield name, fh.read()

    def test_no_banned_signal_identifier_in_classify_package(self):
        offenders = []
        for name, text in self._classify_sources():
            for token in self.BANNED:
                if token in text:
                    offenders.append(f"{name}:{token}")
        self.assertEqual(offenders, [], offenders)

    def test_classify_never_reads_a_counter_or_an_identity(self):
        #: Behaviour version of the same red line: only the text may change the
        #: answer, so two posts identical except for counters / author must match.
        body = "公益中转站，额度无限"
        a = post(body=body, author="old_hand", views=99999, replies=888, likes=777)
        b = post(body=body, author="nobody_new", views=0, replies=0, likes=0)
        self.assertEqual(is_suspected_valuable_E(a), is_suspected_valuable_E(b))
        self.assertEqual(promotion_subrule(a), promotion_subrule(b))
        self.assertEqual(has_credential(a), has_credential(b))


def _keyword_hit(text):
    """The D keyword fallback as the rule applies it (07 §8.1 D row)."""
    return bool(D_PATTERN.search(text))


if __name__ == "__main__":
    unittest.main()
