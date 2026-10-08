"""P0-2 / P0-3 source-adapter tests (07 §5.1, ARCHITECTURE 2.3).

Self-contained: every assertion runs against a fake transport and the JSON
fixtures under ``crawler/fixtures/`` (02-verbatim shapes plus ``sk-TESTFAKE``
fabrications). No network, no ``crawler/data/`` DB, no real key. The live
read-only smoke tests live in ``test_sources_smoke.py`` and skip themselves when
the network is unavailable.

Security note (07 §8.5): the credential used here is the fixture's
``sk-TESTFAKE...`` fabrication, and the suite asserts that no key-shaped string
ever lands in ``adapter.warnings`` / ``adapter.pending_alerts``.
"""
from __future__ import annotations

import json
import os
import sys
import unittest
import urllib.error
from collections.abc import Sequence

CRAWLER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if CRAWLER_DIR not in sys.path:
    sys.path.insert(0, CRAWLER_DIR)

import interfaces  # noqa: E402
from fixtures import load  # noqa: E402
from sources import linux_sb as mod  # noqa: E402
from sources.linux_sb import LinuxSbAdapter  # noqa: E402

API_BASE = "https://linuxsb.tux298.com/api/latest"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

#: Body longer than the aggregator's ~200-char ceiling, used to prove that
#: enrichment bypasses the truncation (07 §5.1 P0-3 / 05 §四 row 2).
KEY = "sk-TESTFAKEa1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0"


class FakeTransport:
    """Route table + call recorder. ``routes`` maps a URL substring to either a
    ``(status, body)`` tuple or a list of them consumed per call; a callable is
    invoked with the url. Anything unrouted raises ``URLError`` (transport down).
    """

    def __init__(self, routes=None, default=None):
        self.routes = dict(routes or {})
        self.default = default
        self.calls = []          # (url, headers, timeout)
        self.sleeps = []

    def __call__(self, url, headers, timeout):
        self.calls.append({"url": url, "headers": dict(headers), "timeout": timeout})
        for fragment, response in self.routes.items():
            if fragment in url:
                if callable(response):
                    return response(url)
                if isinstance(response, list):
                    value = response.pop(0) if response else (500, "")
                    return value
                return response
        if self.default is not None:
            if isinstance(self.default, list):
                return self.default.pop(0) if self.default else (500, "")
            return self.default
        raise urllib.error.URLError("unrouted url %s" % url)

    def urls(self):
        return [call["url"] for call in self.calls]


class RecordingAlerter:
    """Stands in for ``alert.DingTalkAlerter`` so the fallback alert is countable."""

    def __init__(self, raises=False):
        self.messages = []
        self.raises = raises

    def notify(self, message):
        if self.raises:
            raise RuntimeError("webhook exploded")
        self.messages.append(message)
        return True


def agg_row(tid, content="独立正文 %d" % 0, **overrides):
    """One aggregator row in the exact 02 §A.3 shape (plus a stray field)."""
    row = {
        "tid": tid,
        "url": "https://linux.sb/topic/%d" % tid,
        "title": "帖子标题 %d" % tid,
        "forum_id": 2,
        "forum_name": "福利放送",
        "author_name": "someone",
        "author_badge": "管理员之友",     # 02 A.3 / live: extra fields must be ignored
        "post_time": "2026-09-28 00:20:23",
        "views_count": 3,
        "replies_count": 0,
        "likes_count": 0,
        "content_text": content,
    }
    row.update(overrides)
    return row


def agg_payload(rows):
    return 200, json.dumps({"code": 0, "total": len(rows), "data": rows}, ensure_ascii=False)


def wrap_ld(document, extra_html="", script_attrs='type="application/ld+json"'):
    """A topic-page-shaped document: one ld+json block plus arbitrary body markup."""
    return (
        "<html><head><script %s>%s</script></head>"
        "<body><article>%s</article></body></html>"
        % (script_attrs, json.dumps(document, ensure_ascii=False), extra_html)
    )


def make_adapter(routes=None, default=None, alerter=None, forums=(2, 8, 3),
                 min_interval_s=0.0, retry_backoff_s=(1.0, 4.0), clock=None):
    transport = FakeTransport(routes, default)
    adapter = LinuxSbAdapter(
        API_BASE,
        UA,
        forums,
        transport=transport,
        alerter=alerter,
        sleeper=transport.sleeps.append,
        min_interval_s=min_interval_s,
        retry_backoff_s=retry_backoff_s,
        clock=clock,
    )
    return adapter, transport


def raw_post(tid=23217, content_text="来点下游接我国模谢谢喵…"):
    """A RawPost as discover() would have produced it."""
    return _raw(tid, content_text)


def _raw(tid, content_text):
    adapter = LinuxSbAdapter(API_BASE, UA)
    return adapter._row_to_raw_post(agg_row(tid, content=content_text))


class DiscoverAggregatorTests(unittest.TestCase):
    """07 §5.1 P0-2 primary path: aggregator + UA + tid cursor + fingerprint dedupe."""

    def test_maps_aggregator_fields_to_raw_post(self):
        adapter, transport = make_adapter(routes={
            "forum=2": agg_payload([agg_row(24195, content="正文甲")]),
            "forum=8": agg_payload([]),
            "forum=3": agg_payload([]),
        })
        posts = adapter.discover(0)
        self.assertEqual(len(posts), 1)
        post = posts[0]
        # Field names match 02 A.3, so the mapping is near-verbatim.
        self.assertEqual(post.tid, 24195)
        self.assertEqual(post.title, "帖子标题 24195")
        self.assertEqual(post.forum_id, 2)
        self.assertEqual(post.forum_name, "福利放送")
        self.assertEqual(post.author_name, "someone")
        self.assertEqual(post.url, "https://linux.sb/topic/24195")
        self.assertEqual(post.content_text, "正文甲")
        self.assertEqual(post.post_time, "2026-09-28 00:20:23")
        self.assertEqual((post.views_count, post.replies_count, post.likes_count), (3, 0, 0))
        self.assertEqual(post.source_id, "linux_sb")

    def test_requests_every_forum_with_limit_100(self):
        adapter, transport = make_adapter(routes={
            "forum=": agg_payload([]),
        })
        adapter.discover(0)
        urls = transport.urls()
        self.assertEqual(len(urls), 3)
        for forum in (2, 8, 3):
            self.assertTrue(any("forum=%d" % forum in url for url in urls), urls)
        for url in urls:
            # "limit 上限 100" (07 §三 / 02 A.3) via AGG_LIMIT_MAX, not a literal.
            self.assertIn("limit=%d" % interfaces.AGG_LIMIT_MAX, url)

    def test_sends_browser_user_agent(self):
        adapter, transport = make_adapter(routes={"forum=": agg_payload([])})
        adapter.discover(0)
        self.assertTrue(transport.calls)
        for call in transport.calls:
            # 02 A.3: without a UA the aggregator answers 403.
            self.assertEqual(call["headers"].get("User-Agent"), UA)
            self.assertEqual(call["timeout"], mod.REQUEST_TIMEOUT_S)

    def test_tid_watermark_cursor(self):
        adapter, _ = make_adapter(routes={
            "forum=2": agg_payload([agg_row(10), agg_row(11), agg_row(12)]),
            "forum=8": agg_payload([]),
            "forum=3": agg_payload([]),
        })
        posts = adapter.discover(11)
        self.assertEqual([post.tid for post in posts], [12])

    def test_fingerprint_dedupe_of_cross_author_reposts(self):
        # 02 D.4: the same 40-char opening re-posted from several accounts.
        duplicate = "🚀 多模型 AI 平台，新用户注册即享 13.88$ 体验金 " + "填充" * 30
        adapter, _ = make_adapter(routes={
            "forum=2": agg_payload([
                agg_row(23622, content=duplicate, author_name="idean99"),
                agg_row(23618, content=duplicate, author_name="spal"),
                agg_row(23560, content=duplicate + "尾巴", author_name="xnsmwqjoiapf"),
            ]),
            "forum=8": agg_payload([agg_row(23558, content=duplicate, author_name="lchapman468")]),
            "forum=3": agg_payload([agg_row(23500, content="完全不同的正文")]),
        })
        posts = adapter.discover(0)
        # Three rows share the first FINGERPRINT_LEN chars (07 §四 ①) -> one kept,
        # the fourth differs, the fifth is unique.
        self.assertEqual(sorted(post.tid for post in posts), [23500, 23622])

    def test_403_is_treated_as_unreachable_and_switches_source(self):
        alerter = RecordingAlerter()
        sitemap = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            '<url><loc>https://linux.sb/topic/24201</loc>'
            '<lastmod>2026-09-28T05:43:55Z</lastmod></url></urlset>'
        )
        adapter, _ = make_adapter(
            routes={"api/latest": (403, "Forbidden"), "sitemap.xml": (200, sitemap)},
            alerter=alerter,
        )
        posts = adapter.discover(0)
        self.assertEqual([post.tid for post in posts], [24201])
        self.assertEqual(len(alerter.messages), 1, alerter.messages)

    def test_unreachable_aggregator_falls_back_to_sitemap_and_alerts_once(self):
        alerter = RecordingAlerter()
        sitemap = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            "<url><loc>https://linux.sb/</loc></url>"
            "<url><loc>https://linux.sb/forum/2</loc></url>"
            "<url><loc>https://linux.sb/topic/24200</loc>"
            "<lastmod>2026-09-28T05:37:15Z</lastmod></url>"
            "<url><loc>https://linux.sb/topic/24201</loc>"
            "<lastmod>2026-09-28T05:43:55Z</lastmod></url>"
            "</urlset>"
        )
        adapter, transport = make_adapter(
            routes={"api/latest": (500, "boom"), "sitemap.xml": (200, sitemap)},
            alerter=alerter,
        )
        posts = adapter.discover(24200)
        self.assertEqual([post.tid for post in posts], [24201])
        # 07 §5.4 ⑥: switching over fires exactly one alert (not one per forum).
        self.assertEqual(len(alerter.messages), 1, alerter.messages)
        self.assertIn("sitemap.xml", alerter.messages[0])
        self.assertEqual(len(adapter.warnings), 1)
        self.assertEqual(adapter.pending_alerts, [])
        # The sitemap request also carries the UA and is requested after the 3 forums.
        self.assertEqual(len(transport.calls), 4)
        self.assertEqual(transport.calls[-1]["headers"]["User-Agent"], UA)

    def test_sitemap_rows_need_enrichment(self):
        sitemap = (
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            "<url><loc>https://linux.sb/topic/24000</loc>"
            "<lastmod>2026-09-27T01:02:03Z</lastmod></url></urlset>"
        )
        adapter, _ = make_adapter(
            routes={"api/latest": (503, ""), "sitemap.xml": (200, sitemap)}
        )
        post = adapter.discover(0)[0]
        self.assertEqual(post.content_text, "")
        self.assertEqual(post.title, "")
        # lastmod is kept in post_time so recency survives the fallback (02 A.2).
        self.assertEqual(post.post_time, "2026-09-27T01:02:03Z")
        self.assertEqual(post.url, "https://linux.sb/topic/24000")
        # An empty body must not be swallowed by the fingerprint dedupe.
        self.assertEqual(post.fingerprint(), "")

    def test_sitemap_is_capped_at_the_page_ceiling(self):
        # 02 A.2: 13443 topic URLs. A first run (watermark 0) must not hand
        # run_cycle thousands of enrichment requests (07 §5.4 ① "单轮 <5 分钟").
        entries = "".join(
            "<url><loc>https://linux.sb/topic/%d</loc>"
            "<lastmod>2026-09-28T05:00:00Z</lastmod></url>" % (1000 + index)
            for index in range(150)
        )
        sitemap = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">%s</urlset>' % entries
        adapter, _ = make_adapter(routes={
            "api/latest": (500, ""), "sitemap.xml": (200, sitemap),
        })
        posts = adapter.discover(0)
        self.assertEqual(len(posts), interfaces.AGG_LIMIT_MAX)
        self.assertEqual(posts[0].tid, 1050)     # oldest 50 dropped
        self.assertEqual(posts[-1].tid, 1149)    # newest kept, ascending order

    def test_partial_forum_failure_does_not_switch_source(self):
        alerter = RecordingAlerter()
        adapter, _ = make_adapter(
            routes={
                "forum=2": agg_payload([agg_row(300)]),
                "forum=8": (500, "boom"),
                "forum=3": (500, "boom"),
            },
            alerter=alerter,
        )
        posts = adapter.discover(0)
        self.assertEqual([post.tid for post in posts], [300])
        # The source answered, so there is no switch and no alert - only a warning.
        self.assertEqual(alerter.messages, [])
        self.assertEqual(len(adapter.warnings), 1)
        self.assertIn("partially unreachable", adapter.warnings[0])

    def test_never_raises_when_both_sources_are_down(self):
        adapter, _ = make_adapter(routes={}, default=None)  # everything raises URLError
        posts = adapter.discover(0)
        self.assertEqual(posts, [])
        self.assertEqual(len(adapter.pending_alerts), 1)
        self.assertTrue(adapter.warnings)

    def test_garbage_payload_degrades_instead_of_raising(self):
        for garbage in ("not json", '{"code": 1}', '{"data": "nope"}', "[]", "{}"):
            adapter, _ = make_adapter(routes={
                "api/latest": (200, garbage),
                "sitemap.xml": (200, "<urlset></urlset>"),
            })
            self.assertEqual(adapter.discover(0), [], garbage)

    def test_rows_without_tid_are_skipped(self):
        row = agg_row(301)
        del row["tid"]
        adapter, _ = make_adapter(routes={
            "forum=": agg_payload([row, agg_row(302)]),
        })
        self.assertEqual([post.tid for post in adapter.discover(0)], [302])


class EnrichTests(unittest.TestCase):
    """07 §5.1 P0-3: JSON-LD articleBody + C/D DOM sniffing + degradation."""

    def test_walks_graph_to_discussion_forum_posting(self):
        fixture = load("linux_sb_jsonld_graph")
        html = wrap_ld(fixture["json_ld"])
        adapter, transport = make_adapter(routes={"topic/22897": (200, html)})
        full = adapter.enrich(_raw(22897, "给习惯使用 RSS / Follow 阅读器的佬友们搓了一个…"))
        self.assertTrue(full.enriched)
        self.assertEqual(full.article_body, "给习惯使用 RSS / Follow 阅读器的佬友们搓了一个…")
        self.assertFalse(full.reply_visible_locked)
        self.assertFalse(full.virtual_card)
        self.assertEqual(full.text, full.article_body)
        # 07 §四 ② URL shape + polite UA/timeout.
        self.assertEqual(transport.calls[0]["url"], "https://linux.sb/topic/22897")
        self.assertEqual(transport.calls[0]["headers"]["User-Agent"], UA)
        self.assertEqual(transport.calls[0]["timeout"], 20.0)

    def test_recovers_credential_hidden_beyond_the_truncation(self):
        # 07 §5.4 ④: at least one key must come from past the 200-char cut.
        fixture = load("linux_sb_jsonld_graph")
        html = wrap_ld(fixture["json_ld_credential_beyond_truncation"])
        truncated = ("填充正文，用于把凭证挤到 200 字之后。" * 20)[:interfaces.TRUNCATED_BODY_LEN]
        adapter, _ = make_adapter(routes={"topic/22897": (200, html)})
        full = adapter.enrich(_raw(22897, truncated))
        self.assertTrue(full.enriched)
        self.assertGreater(len(full.article_body), interfaces.TRUNCATED_BODY_LEN)
        self.assertIn(KEY, full.article_body)
        self.assertNotIn(KEY, full.raw.content_text)   # the aggregator copy lacks it
        self.assertEqual(full.text, full.article_body)

    def test_reply_visible_locked_marker_is_sniffed(self):
        # 02 A.4 / A.5 verbatim: the locked section is an empty shell for guests,
        # and the JSON-LD body stops at the placeholder (87 chars measured live).
        fixture = load("linux_sb_23217")
        document = {
            "@context": "https://schema.org",
            "@graph": [
                {"@type": "WebPage", "@id": fixture["url"]},
                {"@type": interfaces.JSONLD_POSTING_TYPE,
                 "articleBody": "x" * (fixture["enriched_body_char_count"] - len(fixture["article_body_tail"]))
                 + fixture["article_body_tail"]},
            ],
        }
        html = wrap_ld(document, extra_html=fixture["locked_section_html_open_tag"])
        adapter, _ = make_adapter(routes={"topic/23217": (200, html)})
        full = adapter.enrich(_raw(23217, fixture["content_text"]))
        self.assertTrue(full.reply_visible_locked)     # C-class re-check (07 §四 ②)
        self.assertFalse(full.virtual_card)
        self.assertTrue(full.enriched)
        self.assertEqual(len(full.article_body), fixture["enriched_body_char_count"])
        self.assertTrue(__import__("re").search(interfaces.C_CLASS_RE, full.article_body))

    def test_card_badges_sniffed_both_marker_spellings(self):
        fixture = load("linux_sb_virtual_card")
        badge_doc = {
            "@context": "https://schema.org",
            "@graph": [{"@type": interfaces.JSONLD_POSTING_TYPE, "articleBody": "积分兑换卡密"}],
        }
        # The list-view badge carries "virtual-card-title-status" (02 A.6).
        adapter, _ = make_adapter(routes={
            "topic/21253": (200, wrap_ld(badge_doc, extra_html=fixture["list_badge_html"])),
        })
        full = adapter.enrich(_raw(21253, "积分兑换"))
        self.assertTrue(full.virtual_card)
        self.assertFalse(full.reply_visible_locked)
        # ".virtual-card-box" is written as a CSS selector in the contract but the
        # page markup spells it without the dot.
        adapter2, _ = make_adapter(routes={
            "topic/21254": (200, wrap_ld(badge_doc, extra_html='<div class="virtual-card-box"></div>')),
        })
        self.assertTrue(adapter2.enrich(_raw(21254, "积分兑换")).virtual_card)
        # Neither badge nor lock marker -> both DOM flags stay False.
        # The price-box fragment of 02 A.5 carries none of the two contract badge
        # markers (D_BADGE_MARKERS is exactly ".virtual-card-box" +
        # "virtual-card-title-status"), so enrichment does not flag it: "积分兑换"
        # there is caught by D_KEYWORDS_RE, which is classify/'s keyword fallback.
        adapter3, _ = make_adapter(routes={
            "topic/21255": (200, wrap_ld(badge_doc, extra_html=fixture["card_html"])),
        })
        full3 = adapter3.enrich(_raw(21255, "积分兑换"))
        self.assertFalse(full3.virtual_card)
        self.assertTrue(full3.enriched)

    def test_degrades_after_backoff_and_never_raises(self):
        adapter, transport = make_adapter(routes={"topic/1": [(500, ""), (503, ""), (500, "")]})
        full = adapter.enrich(_raw(1, "x" * 300))
        # 02 §B.6 line 171: 5xx/000 -> 1s then 4s, three attempts, then degrade.
        self.assertEqual(transport.sleeps, [1.0, 4.0])
        self.assertEqual(len(transport.calls), 3)
        self.assertFalse(full.enriched)         # the contract's degraded_enrich marker
        self.assertEqual(len(full.article_body), interfaces.TRUNCATED_BODY_LEN)
        # Contract nuance (interfaces.py:303-306): with enriched=False, FullPost.text
        # is the raw aggregator copy, and the aggregator already caps it near 200
        # chars (02 §A.3). article_body is the adapter's own explicit
        # TRUNCATED_BODY_LEN fallback, so a consumer reading either field degrades.
        self.assertEqual(full.text, full.raw.content_text)
        self.assertEqual(full.article_body, full.raw.content_text[:interfaces.TRUNCATED_BODY_LEN])
        self.assertTrue(adapter.warnings)

    def test_gone_404_is_not_retried(self):
        adapter, transport = make_adapter(routes={"topic/999999": (404, "Not Found")})
        full = adapter.enrich(_raw(999999, "短正文"))
        self.assertEqual(len(transport.calls), 1)
        self.assertEqual(transport.sleeps, [])
        self.assertFalse(full.enriched)
        self.assertEqual(full.article_body, "短正文")

    def test_200_without_article_body_keeps_dom_sniffing(self):
        # JSON-LD shape change (07 §九 "解析失败即告警降级"): the body is lost but
        # the lock marker is still evidence, so classify can still land on C.
        html = wrap_ld({"@context": "https://schema.org", "@graph": [{"@type": "WebPage"}]},
                       extra_html='<section class="%s"></section>'
                       % interfaces.REPLY_VISIBLE_LOCKED_MARKER)
        adapter, _ = make_adapter(routes={"topic/5": (200, html)})
        full = adapter.enrich(_raw(5, "回复可见占位"))
        self.assertFalse(full.enriched)
        self.assertTrue(full.reply_visible_locked)
        self.assertEqual(full.text, "回复可见占位")

    def test_transport_failure_degrades(self):
        adapter, transport = make_adapter(routes={}, default=None)  # raises URLError
        full = adapter.enrich(_raw(7, "正文"))
        self.assertFalse(full.enriched)
        self.assertEqual(full.article_body, "正文")
        self.assertEqual(len(transport.calls), 3)   # retried on 000/timeout
        self.assertIn("transport error", adapter.warnings[0])

    def test_polite_interval_between_requests_to_one_host(self):
        html = wrap_ld({"@graph": [{"@type": interfaces.JSONLD_POSTING_TYPE,
                                    "articleBody": "全文"}]})
        # A frozen clock (always 0) makes every gap look like 0 -> full wait each time.
        adapter, transport = make_adapter(
            routes={"linux.sb/topic/": (200, html)}, min_interval_s=0.5, clock=lambda: 0.0
        )
        adapter.enrich(_raw(8, "a"))
        adapter.enrich(_raw(9, "b"))
        self.assertEqual(len(transport.calls), 2)
        self.assertTrue(transport.sleeps, transport.sleeps)
        for slept in transport.sleeps:
            self.assertGreaterEqual(slept, interfaces.PROBE_SAME_HOST_MIN_INTERVAL_S)

    def test_no_credential_leaks_into_warnings_or_alerts(self):
        alerter = RecordingAlerter()
        fixture = load("linux_sb_jsonld_graph")
        html = wrap_ld(fixture["json_ld_credential_beyond_truncation"])
        adapter, _ = make_adapter(
            routes={"api/latest": (500, ""), "linux.sb/topic/": (500, ""),
                    "sitemap.xml": (200, "<urlset></urlset>")},
            alerter=alerter,
        )
        adapter.discover(0)
        adapter.enrich(_raw(42, KEY))
        shapes = (interfaces.PRIMARY_CREDENTIAL_RE, interfaces.GENERIC_CREDENTIAL_RE,
                  interfaces.GOOGLE_CREDENTIAL_RE)
        for text in adapter.warnings + adapter.pending_alerts + alerter.messages:
            for pattern in shapes:
                for hit in __import__("re").findall(pattern, text):
                    self.fail("credential-shaped string %r in %r" % (hit[:12], text[:80]))


class JsonLdParserTests(unittest.TestCase):
    """Parser-level cases behind enrich (07 §四 ② path only)."""

    def test_plain_object_without_graph(self):
        html = wrap_ld({"@type": interfaces.JSONLD_POSTING_TYPE, "articleBody": "裸对象全文"})
        self.assertEqual(mod.find_article_body(html), "裸对象全文")

    def test_type_list_and_array_document(self):
        document = [{"@graph": [{"@type": ["DiscussionForumPosting", "Article"],
                                 "articleBody": "数组文档"}]}]
        self.assertEqual(mod.find_article_body(
            '<script type="application/ld+json">%s</script>'
            % json.dumps(document, ensure_ascii=False)
        ), "数组文档")

    def test_malformed_block_is_skipped_and_next_one_wins(self):
        html = (
            '<script type="application/ld+json">{ broken</script>'
            '<script type=\'application/ld+json\'>%s</script>'
            % json.dumps({"@graph": [{"@type": interfaces.JSONLD_POSTING_TYPE,
                                      "articleBody": "第二块"}]}, ensure_ascii=False)
        )
        self.assertEqual(mod.find_article_body(html), "第二块")

    def test_missing_or_empty_body_returns_empty_string(self):
        self.assertEqual(mod.find_article_body("<html>no json-ld at all</html>"), "")
        self.assertEqual(mod.find_article_body(""), "")
        self.assertEqual(mod.find_article_body(
            '<script type="application/ld+json">{"@graph":[{"@type":"WebPage",'
            '"articleBody":"wrong node"}]}</script>'
        ), "")

    def test_script_tag_attribute_order_is_tolerated(self):
        html = ('<script defer type="application/ld+json">'
                '{"@type":"DiscussionForumPosting","articleBody":"顺序无关"}</script>')
        self.assertEqual(mod.find_article_body(html), "顺序无关")


class ContractConformanceTests(unittest.TestCase):
    """The adapter must stay inside the frozen ABC (ARCHITECTURE 2.2 / 3.2)."""

    def test_adapter_is_a_source_adapter_with_source_id(self):
        adapter = LinuxSbAdapter(API_BASE, UA)
        self.assertIsInstance(adapter, interfaces.SourceAdapter)
        self.assertEqual(adapter.source_id, "linux_sb")
        self.assertEqual(adapter.forums, (2, 8, 3))     # 07 §5.2 FORUMS=2,8,3

    def test_three_positional_args_still_work(self):
        # main.build_components:114 constructs it positionally; extra knobs must
        # stay keyword-only or the skeleton wiring breaks.
        adapter = LinuxSbAdapter(API_BASE, UA, (2,))
        self.assertEqual(adapter.forums, (2,))
        self.assertEqual(adapter.timeout_s, mod.REQUEST_TIMEOUT_S)
        self.assertEqual(adapter.min_interval_s, interfaces.PROBE_SAME_HOST_MIN_INTERVAL_S)

    def test_classify_rules_hook_delegates_to_classifier_owner(self):
        """D10: the adapter only forwards to classify/rules_linux_sb.py.

        It must not define C/D rules itself (07 §8.1 规则分层). The assertion is
        deliberately loose about the rule *set* - that is owner B's contract - and
        strict about the *shape* the engine consumes.
        """
        adapter = LinuxSbAdapter(API_BASE, UA)
        try:
            rules = adapter.classify_rules()
        except NotImplementedError as exc:
            self.assertIn("P0-4", str(exc))
            self.skipTest("classify/rules_linux_sb.py is still the P0-4 stub")
            return
        self.assertIsInstance(rules, Sequence)
        for rule in rules:
            self.assertIsInstance(rule, interfaces.ClassifyRule)
            self.assertIn(rule.category, interfaces.CATEGORIES)
        # 07 §8.1: the linux.sb-specific classes are exactly C and D.
        self.assertEqual(set(r.category for r in rules), {"C", "D"},
                         "source-specific rules must be the C/D pair (D10)")


class NeverRaisesTests(unittest.TestCase):
    """``main.py:172`` calls ``discover`` and ``main.py:183`` calls ``enrich``; the
    cycle must survive any exception a transport can raise (07 §九 "解析失败即告警
    降级"), not only the URLError/OSError family the first draft caught."""

    def test_unexpected_exception_falls_back_and_never_propagates(self):
        def boom(url):
            raise RuntimeError("a transport nobody predicted")

        alerter = RecordingAlerter()
        adapter, _ = make_adapter(
            routes={API_BASE: boom, "sitemap.xml": boom}, alerter=alerter
        )
        posts = adapter.discover(0)          # must not raise
        self.assertEqual(posts, [])          # sitemap also dead -> empty batch
        self.assertEqual(len(alerter.messages), 1, alerter.messages)
        self.assertTrue(adapter.warnings)

    def test_unexpected_exception_in_enrich_degrades(self):
        def boom(url):
            raise RuntimeError("a transport nobody predicted")

        adapter, transport = make_adapter(
            routes={"linux.sb/topic": boom}, retry_backoff_s=(1.0, 4.0)
        )
        full = adapter.enrich(_raw(1, "正文" * 200))
        self.assertFalse(full.enriched)
        self.assertEqual(len(transport.calls), 3)     # retried, then degraded
        self.assertEqual(transport.sleeps, [1.0, 4.0])

    def test_notimplementederror_still_propagates(self):
        # The skeleton's pending-stage protocol depends on NotImplementedError
        # reaching run_cycle (main.py:183 re-raises it), so the broad except must
        # not swallow it.
        def not_done(url):
            raise NotImplementedError("stage not implemented")

        adapter, _ = make_adapter(routes={"linux.sb/topic": not_done})
        with self.assertRaises(NotImplementedError):
            adapter.enrich(_raw(1, "正文"))


if __name__ == "__main__":
    unittest.main()
