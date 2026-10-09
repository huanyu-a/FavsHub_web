"""Unit tests for :mod:`extract.provider` and :mod:`extract.models` (2026-10-09).

Both modules exist to fill two columns that had never been written:
``token_keys.provider`` (empty on every relay row -> the card fell back to the
post title) and ``token_keys.models`` (empty on every row -> the model chips
could not render).

Self-contained per the repo rules: no network, no ``crawler/data/``, and no
credential-shaped literal other than the mandatory ``sk-TESTFAKE`` prefix
(07 §8.5). Vendor-prefix keys are assembled at runtime, exactly like
``test_extract_credentials.py``, because the repo-wide red-line scan in
``test_fixtures_safety.py`` walks every ``.py`` under ``crawler/``.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from extract import credentials as C  # noqa: E402
from extract.models import MODELS_MAX, find_model_mentions  # noqa: E402
from extract.provider import (  # noqa: E402
    PROVIDER_BRANDS,
    provider_for_base_url,
    resolve_provider,
)
from interfaces import FullPost, RawPost  # noqa: E402

_TAIL = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"


def _relay_key() -> str:
    # sk-TESTFAKE prefix: allowed to be a literal (07 §8.5).
    return "sk-TESTFAKE" + _TAIL


def _vendor(prefix: str) -> str:
    """Build a vendor-shaped fake key at runtime (never a source literal)."""
    return prefix + _TAIL


def _post(body: str, tid: int = 23531) -> FullPost:
    raw = RawPost(tid=tid, title="fake title", forum_id=2, forum_name="福利放送",
                  author_name="tester", url=f"https://linux.sb/topic/{tid}",
                  content_text=body)
    return FullPost(raw=raw, article_body=body, enriched=True)


class ProviderHostTests(unittest.TestCase):
    """``provider_for_base_url`` - host extraction + brand lookup."""

    def test_curated_brands(self):
        for host, brand in (("https://api.openai.com/v1", "OpenAI"),
                            ("https://api.deepseek.com", "DeepSeek"),
                            ("https://openrouter.ai/api/v1", "OpenRouter"),
                            ("https://api.anthropic.com/v1", "Anthropic"),
                            ("https://api.x.ai/v1", "xAI"),
                            ("https://generativelanguage.googleapis.com/v1beta", "Google Gemini")):
            with self.subTest(host=host):
                self.assertEqual(brand, provider_for_base_url(host))

    def test_www_is_stripped_before_lookup(self):
        # aivalux.com is not curated: the relay keeps its own domain either way.
        self.assertEqual("aivalux.com", provider_for_base_url("https://www.aivalux.com"))

    def test_relay_keeps_its_own_domain(self):
        # The honest label for a relay: mislabelling it as a vendor would be a
        # factual error on the card, and the host is already public via base_url.
        for host, want in (("https://xlai.pro", "xlai.pro"),
                           ("https://sky-code.org", "sky-code.org"),
                           ("https://free.zynk.bot.cd/", "free.zynk.bot.cd"),
                           ("https://max.ai0728.com.cn", "max.ai0728.com.cn")):
            with self.subTest(host=host):
                self.assertEqual(want, provider_for_base_url(host))

    def test_url_components_are_dropped(self):
        self.assertEqual("api.example.test",
                         provider_for_base_url("https://user:pw@api.example.test:8443/v1/models?x=1#f"))
        self.assertEqual("api.example.test", provider_for_base_url("//api.example.test/v1"))

    def test_private_and_local_hosts_are_not_brands(self):
        for host in ("http://127.0.0.1:8080/v1", "http://localhost:3000",
                     "http://192.168.1.10/v1", "http://10.0.0.5/v1"):
            with self.subTest(host=host):
                self.assertEqual("", provider_for_base_url(host))

    def test_unusable_input_is_empty_not_a_guess(self):
        for value in ("", "   ", "not a url", "v1/models", "http://relay/v1"):
            with self.subTest(value=value):
                self.assertEqual("", provider_for_base_url(value))

    def test_never_raises(self):
        for value in (None, 0, [], "https://", "https://:8080"):
            with self.subTest(value=value):
                self.assertIsInstance(provider_for_base_url(value), str)  # type: ignore[arg-type]

    def test_brand_table_keys_are_bare_hosts(self):
        # A scheme / path in a table key would silently never match.
        for host in PROVIDER_BRANDS:
            self.assertNotIn("/", host, host)
            self.assertEqual(host, host.lower(), host)


class ResolveProviderTests(unittest.TestCase):
    """Prefix evidence outranks the contextual host (07 §8.2)."""

    def test_prefix_wins_over_host(self):
        self.assertEqual("openrouter.ai",
                         resolve_provider(_vendor("sk-or-v1-"), "https://relay.example.test/v1",
                                          "openrouter.ai"))

    def test_host_used_when_there_is_no_prefix(self):
        self.assertEqual("xlai.pro",
                         resolve_provider(_relay_key(), "https://xlai.pro", ""))

    def test_nothing_known_stays_empty(self):
        self.assertEqual("", resolve_provider(_relay_key(), "", ""))


class ModelMentionTests(unittest.TestCase):
    """``find_model_mentions`` - curated families only, no invented versions."""

    def test_live_titles_from_the_deployed_rows(self):
        # Verbatim titles of the 13 production rows (2026-10-09).
        cases = (
            ("Opus5.5-100刀，仅限开发，限制CC客户端使用", ["Claude Opus 5.5"]),
            ("免费token", []),
            ("福利key", []),
            ("🆕 无限deepseek 持续放松 已送【2.5】亿", ["DeepSeek"]),
            ("免费的grok4.6 速蹬", ["Grok 4.6"]),
            ("GLM模型Token大放送", ["GLM"]),
        )
        for title, want in cases:
            with self.subTest(title=title):
                self.assertEqual(want, find_model_mentions(title))

    def test_family_labels_without_a_stated_version(self):
        for text, want in (("deepseek 无限量", ["DeepSeek"]),
                           ("claude sonnet 免费", ["Claude Sonnet"]),
                           ("gemini 白嫖", ["Gemini"]),
                           ("qwen 系列", ["Qwen"]),
                           ("glm-4.6 体验", ["GLM 4.6"])):
            with self.subTest(text=text):
                self.assertEqual(want, find_model_mentions(text))

    def test_version_is_kept_only_when_stated(self):
        self.assertEqual(["Grok 4.6"], find_model_mentions("grok4.6"))
        self.assertEqual(["Grok"], find_model_mentions("grok"))
        self.assertEqual(["Claude Opus 5.5"], find_model_mentions("Opus5.5"))
        self.assertEqual(["Claude Opus"], find_model_mentions("opus 免费"))

    def test_claude_variants_are_distinguished(self):
        # A stated version is kept (see test_version_is_kept_only_when_stated),
        # so these expect the full label the source actually wrote.
        for text, want in (("claude-opus-4-1", "Claude Opus 4"),
                           ("sonnet 4 免费", "Claude Sonnet 4"),
                           ("haiku 秒回", "Claude Haiku")):
            with self.subTest(text=text):
                self.assertIn(want, find_model_mentions(text))

    def test_cjk_aliases(self):
        for text, want in (("深度求索官方", "DeepSeek"),
                           ("通义千问 白嫖", "Qwen"),
                           ("智谱 赠送", "GLM"),
                           ("月之暗面", "Kimi")):
            with self.subTest(text=text):
                self.assertIn(want, find_model_mentions(text))

    def test_urls_and_keys_never_become_models(self):
        # "/v1/models" in an endpoint and an sk- tail must not yield a chip.
        self.assertEqual([], find_model_mentions("https://api.gptgod.online/v1/models 无限"))
        self.assertEqual([], find_model_mentions(f"{_relay_key()} https://relay.example.test"))

    def test_bare_ops_name_needs_a_model_neighbour(self):
        self.assertEqual([], find_model_mentions("o3"))
        self.assertIn("o3", find_model_mentions("gpt-4o 与 o3 模型"))

    def test_dedupe_order_and_cap(self):
        self.assertEqual(["DeepSeek", "Grok 4.6"],
                         find_model_mentions("deepseek … grok4.6 … deepseek … grok4.6"))
        chatter = " ".join(f"grok {n}.0" for n in range(1, 40))
        self.assertLessEqual(len(find_model_mentions(chatter)), MODELS_MAX)

    def test_empty_and_degenerate_input(self):
        for value in ("", "   ", "免费token", "回复可见"):
            with self.subTest(value=value):
                self.assertEqual([], find_model_mentions(value))
        self.assertEqual([], find_model_mentions(None))  # type: ignore[arg-type]

    def test_scan_is_utf8_json_safe(self):
        labels = find_model_mentions("deepseek 与 grok4.6 免费")
        self.assertEqual(labels, json.loads(json.dumps(labels, ensure_ascii=False)))


class ExtractorIntegrationTests(unittest.TestCase):
    """The two columns must actually leave the extractor filled."""

    def test_relay_pair_gets_host_provider_and_models(self):
        body = f"https://xlai.pro，{_relay_key()}\n无限deepseek 免费送"
        pairs = C.LayeredExtractor().extract(_post(body))
        self.assertEqual(1, len(pairs))
        self.assertEqual("xlai.pro", pairs[0].provider)
        self.assertEqual(("DeepSeek",), tuple(pairs[0].models))

    def test_prefix_still_wins_at_the_pair_level(self):
        body = f"endpoint https://relay.example.test/v1 token {_vendor('sk-or-v1-')}"
        pairs = C.LayeredExtractor().extract(_post(body))
        self.assertEqual("openrouter.ai", pairs[0].provider)

    def test_no_models_mention_leaves_an_empty_tuple(self):
        body = f"https://relay.example.test/v1\n{_relay_key()}"
        pairs = C.LayeredExtractor().extract(_post(body))
        self.assertEqual((), tuple(pairs[0].models))

    def test_models_are_json_serialisable_by_the_store_layer(self):
        body = f"https://relay.example.test/v1\n{_relay_key()}\n免费grok4.6"
        pair = C.LayeredExtractor().extract(_post(body))[0]
        self.assertEqual(["Grok 4.6"], json.loads(json.dumps(list(pair.models), ensure_ascii=False)))


if __name__ == "__main__":
    unittest.main()
