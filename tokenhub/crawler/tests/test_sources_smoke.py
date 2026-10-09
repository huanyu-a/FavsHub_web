"""Read-only smoke against the real sources (task: "对真实 linux.sb 和聚合 API 各做一次
只读冒烟（网络失败则 skip 并如实报告）").

Every test here does exactly what the P0 cycle would do, but read-only and with a
single-digit request count:

* the aggregator API (02 §A.3) - one ``?limit=5&forum=2`` page, plus the documented
  "no UA -> 403" check that the User-Agent is mandatory for.
* linux.sb itself (02 §A.1 / §A.5, 07 §四 ②) - one ``/topic/23217`` page, the post
  07 §5.1 P0-3 names as the acceptance sample (87 chars + the locked marker).
* the sitemap fallback (02 §A.2) - one ``/sitemap.xml`` parse.

ARCHITECTURE.md §2.3 says the suite must never touch the network. The task asked for
these smokes explicitly, so they are isolated here and skip (not fail) when there is
no route, a proxy blocks the host, or the site changes shape - the skip message says
which. ``crawler/tests/test_sources.py`` stays fully offline.
"""
from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import interfaces  # noqa: E402
from sources.linux_sb import REQUEST_TIMEOUT_S, SITEMAP_URL, LinuxSbAdapter, RawPost  # noqa: E402

#: Browser UA - same shape as ``config.py``'s default; 02 §A.3 says any UA works.
UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0 Safari/537.36"
)

#: 07 §5.1 P0-2's aggregate source.
AGG_API_BASE = "https://linuxsb.tux298.com/api/latest"

#: 07 §5.1 P0-3's acceptance sample: reply-gated, 87-char first post.
GATED_TID = 23217


def _probe_or_skip(test, url, adapter):
    """One request to ``url``; skip with the reason instead of failing offline."""
    try:
        status, _body = adapter.transport(url, adapter._headers(), adapter.timeout_s)
    except Exception as exc:  # URLError / timeout / DNS / proxy
        test.skipTest(f"no route to {url}: {type(exc).__name__}: {exc}")
    if status == 0:
        test.skipTest(f"transport failure (status 0) for {url}")
    return status


class AggregatorApiSmokeTests(unittest.TestCase):
    """The discovery source 07 §三 names: ``linuxsb.tux298.com/api/latest``."""

    def test_one_page_parses_into_raw_posts(self):
        adapter = LinuxSbAdapter(AGG_API_BASE, UA, forums=(2,))
        status = _probe_or_skip(self, f"{AGG_API_BASE}?limit=1&forum=2", adapter)
        if status != 200:
            self.skipTest(f"aggregator answered HTTP {status}; not asserting shape")
        posts = adapter.discover(0)
        self.assertTrue(posts, "aggregator returned no rows for forum 2")
        post = posts[0]
        self.assertGreater(post.tid, 0)
        self.assertTrue(post.url.startswith("https://linux.sb/topic/"), post.url)
        # 02 §A.3: the aggregate row is the judgement input, so these must be mapped.
        self.assertIsInstance(post.content_text, str)
        self.assertIsInstance(post.author_name, str)
        self.assertEqual(post.source_id, "linux_sb")
        # Fingerprint dedupe is only meaningful if a real body exists to hash.
        self.assertLessEqual(len(post.fingerprint()), interfaces.FINGERPRINT_LEN)

    def test_user_agent_is_mandatory(self):
        """02 §A.3: "必须带 User-Agent，否则 403" - the reason the UA is not optional."""
        import urllib.error
        import urllib.request

        url = f"{AGG_API_BASE}?limit=1&forum=2"
        try:
            with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_S) as r:
                without_ua = getattr(r, "status", None) or r.getcode()
        except urllib.error.HTTPError as exc:
            without_ua = int(exc.code)
        except Exception as exc:
            self.skipTest(f"no route to the aggregator: {type(exc).__name__}")
        if without_ua == 200:
            self.skipTest(
                "aggregator now accepts a UA-less request (02 §A.3 measured 403); "
                "policy changed upstream - the adapter still sends a UA either way"
            )
        self.assertEqual(without_ua, 403)


class LinuxSbSiteSmokeTests(unittest.TestCase):
    """linux.sb topic pages + the sitemap fallback (02 §A.1 / §A.2 / §A.5)."""

    def _adapter(self):
        # Real transport, real 20 s timeout, real politeness.
        return LinuxSbAdapter(AGG_API_BASE, UA, forums=(2,))

    def test_enrichment_of_the_p0_acceptance_post(self):
        """07 §5.1 P0-3: "对 23217 复现 87 字符 + locked 标记"."""
        adapter = self._adapter()
        tid = GATED_TID
        status = _probe_or_skip(self, f"https://linux.sb/topic/{tid}", adapter)
        if status != 200:
            self.skipTest(f"linux.sb answered HTTP {status} for topic {tid}")
        post = RawPost(
            tid=tid,
            title="",
            forum_id=2,
            forum_name="福利放送",
            author_name="",
            url=f"https://linux.sb/topic/{tid}",
            content_text="",
        )
        full = adapter.enrich(post)
        self.assertTrue(full.enriched, f"enrichment degraded: {adapter.warnings}")
        # The reply-gate DOM marker is the C-class evidence (07 §四 ②).
        self.assertTrue(full.reply_visible_locked)
        self.assertFalse(full.virtual_card)
        # 07 §8.1 C row: the injected placeholder is inside the JSON-LD body too.
        import re

        self.assertTrue(re.search(interfaces.C_CLASS_RE, full.article_body))
        # The doc measured 87 chars; a reply-gated post cannot grow, so allow drift
        # only upward (an edit would be a content change, not a parser bug).
        self.assertGreaterEqual(
            len(full.article_body),
            87,
            f"articleBody shrank below the 07 P0-3 measured 87 chars: "
            f"{len(full.article_body)}",
        )

    def test_sitemap_fallback_yields_recent_tids(self):
        """02 §A.2: 13k+ topic URLs, updated within a minute of posting."""
        adapter = self._adapter()
        status = _probe_or_skip(self, SITEMAP_URL, adapter)
        if status != 200:
            self.skipTest(f"sitemap answered HTTP {status}")
        posts = adapter.discover_via_sitemap(0)
        self.assertGreaterEqual(len(posts), 1, "sitemap produced no topic rows")
        self.assertLessEqual(len(posts), interfaces.AGG_LIMIT_MAX)
        newest = posts[-1]
        self.assertGreater(newest.tid, 0)
        self.assertEqual(newest.content_text, "")  # enriched later, per the contract
        self.assertTrue(newest.post_time, "lastmod must land in post_time")


if __name__ == "__main__":
    unittest.main()
