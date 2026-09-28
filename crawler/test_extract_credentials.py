"""Unit tests for :mod:`extract.credentials` (07 §8.2, task P0-5).

Self-contained per the rules: no network, no real key, no ``crawler/data/``.
Every credential literal that starts with ``sk-`` uses the mandatory
``sk-TESTFAKE`` prefix (07 §8.5). Vendor-prefix keys that do not start with
``sk-`` (``sk-or-v1``, ``AIza``, ``gsk_`` ...) are assembled at runtime from
fragments, so no credential-shaped, non-fake string ever appears in this file:
the repo-wide red-line scan in ``test_fixtures_safety.py`` walks every ``.py``
under ``crawler/`` and would flag such a literal. The runtime fragments (and the
``test_forbidden_patterns_are_self_tested`` control below) prove the guarantee is
meaningful, not vacuous.
"""
from __future__ import annotations

import ast
import base64
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import crypto  # noqa: E402
import fixtures  # noqa: E402
import interfaces  # noqa: E402
from extract import credentials as C  # noqa: E402
from interfaces import (  # noqa: E402
    CATEGORY_B,
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    KEY_SOURCE_AGGREGATOR_LEAK,
    KEY_SOURCE_POST,
    PAIR_DISAMBIG_MAX_CANDIDATES,
    ClassifiedPost,
    CredentialPair,
    FullPost,
    ProbeOutcome,
    RawPost,
    VerdictDecision,
)

CREDENTIALS_MODULE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "extract", "credentials.py"
)

#: 07 §8.2 vendor prefixes that are not ``sk-``; assembled at runtime.
_TAIL = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0"
_BEARER = "Bearer "
_CODE_FENCE = "`" * 3


def _vendor(prefix: str, tail: str = _TAIL) -> str:
    """Build a vendor-shaped fake key at runtime (never a source literal)."""
    return prefix + tail


def _relay_key(tail: str = _TAIL) -> str:
    # starts with sk-TESTFAKE, so it may be a literal: 07 §8.5 + red-line scan.
    return "sk-TESTFAKE" + tail


_KEY = _relay_key()  # an anonymous New-API-style relay credential (sk-TESTFAKE)
_URL1 = "https://relay.example.test/v1"
_URL2 = "https://alt.example.test/v1"


def _post(body: str, tid: int = 23531) -> FullPost:
    raw = RawPost(tid=tid, title="fake title", forum_id=2, forum_name="福利放送",
                  author_name="tester", url=f"https://linux.sb/topic/{tid}",
                  content_text=body)
    return FullPost(raw=raw, article_body=body, enriched=True)


class StrippingTests(unittest.TestCase):
    def test_bearer_prefix_is_removed_before_matching(self):
        body = f"Authorization: {_BEARER}{_KEY}"
        self.assertIn("Bearer", body)
        cleaned = C.strip_bearer(body)
        self.assertNotIn("bearer", cleaned.lower())
        self.assertIn(_KEY, C.find_credentials(cleaned))

    def test_bearer_stripping_preserves_line_geometry(self):
        body = f"header line\nline2 {_BEARER} continues\nline3 {_KEY}"
        cleaned = C.strip_bearer(body)
        self.assertEqual(body.count("\n"), cleaned.count("\n"))
        lines = cleaned.split("\n")
        self.assertEqual("line2 continues", lines[1])
        self.assertIn(_KEY, lines[2])

    def test_strip_empty(self):
        self.assertEqual("", C.strip_bearer(""))


class LayeredRegexTests(unittest.TestCase):
    def test_primary_prefix_shapes_are_extracted(self):
        for prefix in ("sk-or-v1-", "sk-ant-api03-", "sk-proj-", "sk-svcacct-",
                       "sk-admin-", "sk-live-", "sk-test-", "gsk_", "xai-", "fw_",
                       "hf_", "pplx-", "r8_", "csk-"):
            token = _vendor(prefix)
            self.assertIn(token, C.find_credentials(token), prefix)

    def test_google_key_matches_the_dedicated_pattern(self):
        aiza = _vendor("AIza", "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p")  # AIza + 35
        self.assertEqual([aiza], C.find_credentials(aiza))

    def test_generic_relief_catches_plain_sk_keys(self):
        relay = _relay_key()
        self.assertEqual([relay], C.find_credentials(relay))
        long_relay = _relay_key("z" * 200)
        self.assertEqual([long_relay], C.find_credentials(long_relay))

    def test_sk_tail_is_never_split_on_dash(self):
        token = "sk-TESTFAKEa1b2c3d4e5f6g7h8i9j0-extra-segment-more"
        self.assertEqual([token], C.find_credentials(f"use {token} now"))

    def test_union_dedupes_and_preserves_order(self):
        a = _relay_key("aaaa" + _TAIL)
        b = _vendor("sk-or-v1-")
        text = f"{a}\n{b}"
        self.assertEqual([a, b], C.find_credentials(text))

    def test_rejects_undersized_and_unprefixed_tokens(self):
        for bad in ("sk-short", "sk-abcdefghijklmnop", "abcdefghij",
                    "Bearer", "token=abcdefghij"):
            self.assertEqual([], C.find_credentials(bad), bad)

    def test_lookbehind_guard_blocks_alnum_and_underscore(self):
        # 07 §8.2 "建议用负向环视版本": the primary (?<![A-Za-z0-9_-]) refuses an
        # embedded key, and the generic \b also refuses when glued by a word char
        # (alnum / underscore) - so neither layer fires on those.
        glued = "1" + _relay_key()
        self.assertEqual([], C.find_credentials(glued))
        glued_us = "_" + _relay_key()
        self.assertEqual([], C.find_credentials(glued_us))
        self.assertIn(_KEY, C.find_credentials(f"start {_KEY} end"))
        # A key glued after '-' is deliberately NOT blocked: 07 §8.2 says "\b 对 -
        # 不成立" and keeps \b on the generic fallback, so the (real) key survives.
        self.assertIn(_KEY, C.find_credentials("-" + _relay_key()))

    def test_affiliate_ids_and_promo_tokens_are_not_credentials(self):
        # 02 §D.2: "32+ upper alnum" is a pure false-positive source (affiliate
        # IDs, precision 0/3). It carries no credential prefix and must not fire.
        aff_query = "?aff=b0de70219c3f4a5d6e7f8091a2b3c4d5e6f7"
        upper_blob = "ABCDEFGH" + "0123456789" * 4
        promo = "注册送20刀 邀请码 AB12CD34EF56  referral=xyz"
        for text in (aff_query, upper_blob, promo):
            self.assertEqual([], C.find_credentials(text), text[:32])

    def test_empty_input(self):
        self.assertEqual([], C.find_credentials(""))
        self.assertEqual([], C.find_urls(""))


class PrefixHintTests(unittest.TestCase):
    def test_prefix_hints_map_to_provider_hosts(self):
        for prefix, host in interfaces.PREFIX_BASE_URL_HINTS:
            self.assertEqual(host, C.provider_for_key(_vendor(prefix)), prefix)

    def test_relay_key_has_no_provider_guess(self):
        self.assertEqual("", C.provider_for_key(_relay_key()))

    def test_prefix_never_fabricates_a_base_url(self):
        # 07 §8.2 / §B.5: sk-or- guesses provider=openrouter, but a key with no
        # URL in the post is dropped, never paired with a prefix-guessed endpoint.
        pairs = C.LayeredExtractor().extract(_post(_vendor("sk-or-v1-")))
        self.assertEqual([], pairs)


class HighConfidencePairingTests(unittest.TestCase):
    def test_same_line_is_high(self):
        body = f"base: {_URL1} key {_KEY}"
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(1, len(pairs))
        self.assertEqual(CONFIDENCE_HIGH, pairs[0].confidence)
        self.assertEqual(_URL1, pairs[0].base_url)
        self.assertIn("same line", pairs[0].evidence)

    def test_markdown_table_row_is_high(self):
        body = f"| relay | {_URL1} | {_KEY} |"
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(CONFIDENCE_HIGH, pairs[0].confidence)
        self.assertIn("table row", pairs[0].evidence)

    def test_same_code_block_is_high(self):
        body = (f"{_CODE_FENCE}\n{_URL1}\n{_KEY}\n{_CODE_FENCE}")
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(CONFIDENCE_HIGH, pairs[0].confidence)
        self.assertIn("code block", pairs[0].evidence)

    def test_same_json_object_is_high(self):
        body = '{\n  "base_url": "%s",\n  "key": "%s"\n}' % (_URL1, _KEY)
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(CONFIDENCE_HIGH, pairs[0].confidence)
        self.assertIn("JSON object", pairs[0].evidence)


class MediumConfidencePairingTests(unittest.TestCase):
    def test_adjacent_lines_are_medium(self):
        body = f"{_URL1}\n{_KEY}"
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(CONFIDENCE_MEDIUM, pairs[0].confidence)

    def test_line_distance_within_three_is_medium(self):
        body = f"{_KEY}\n{_URL1}\nfiller\nfiller"
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(CONFIDENCE_MEDIUM, pairs[0].confidence)

    def test_sole_key_and_url_far_apart_is_medium(self):
        body = _KEY + "\n" + "\n".join(f"filler{i}" for i in range(6)) + f"\n{_URL1}"
        pairs = C.pair([_KEY], [_URL1], body)
        self.assertEqual(CONFIDENCE_MEDIUM, pairs[0].confidence)
        self.assertIn("sole", pairs[0].evidence)

    def test_lone_pair_in_a_paragraph_is_medium(self):
        k1 = "sk-TESTFAKEk1" + _TAIL
        k2 = "sk-TESTFAKEk2" + _TAIL
        u2 = "https://other.example.test/v1"
        body = f"{k1}\n\n{_URL1}\n\n{k2}\n\n{u2}"
        pairs = C.pair([k1, k2], [_URL1, u2], body)
        self.assertEqual(2, len(pairs))
        self.assertTrue(all(p.confidence == CONFIDENCE_MEDIUM for p in pairs))


class LowConfidencePairingTests(unittest.TestCase):
    def test_one_url_many_keys_is_low(self):
        k1 = "sk-TESTFAKEk1" + _TAIL
        k2 = "sk-TESTFAKEk2" + _TAIL
        body = f"{_URL1}\n{k1}\n{k2}"
        pairs = C.pair([k1, k2], [_URL1], body)
        self.assertEqual(2, len(pairs))
        for p in pairs:
            self.assertEqual(CONFIDENCE_LOW, p.confidence)
            self.assertEqual(_URL1, p.base_url)

    def test_one_key_many_urls_expands_to_candidates(self):
        body = f"{_KEY}\n{_URL1}\n{_URL2}"
        pairs = C.pair([_KEY], [_URL1, _URL2], body)
        self.assertEqual(2, len(pairs))
        for p in pairs:
            self.assertEqual(CONFIDENCE_LOW, p.confidence)
            self.assertIn("candidate", p.evidence)
        self.assertEqual({_URL1, _URL2}, {p.base_url for p in pairs})

    def test_key_without_any_url_is_dropped(self):
        self.assertEqual([], C.pair([_KEY], [], f"just {_KEY} here"))


class DisambiguationTests(unittest.TestCase):
    @staticmethod
    def _candidates(key: str, urls) -> list:
        return C.pair([key], list(urls), f"{key}\n" + "\n".join(urls))

    def test_first_non_401_pairing_wins(self):
        prober = _RecordingProber({_URL1: 401, _URL2: 200})
        out = C.disambiguate(self._candidates(_KEY, [_URL1, _URL2]), prober)
        self.assertEqual(1, len(out))
        self.assertEqual(_URL2, out[0].base_url)
        self.assertEqual(CONFIDENCE_MEDIUM, out[0].confidence)
        self.assertIn("probe-ok", out[0].evidence)
        self.assertEqual([_URL1, _URL2], prober.calls)

    def test_transport_zero_is_inconclusive_then_confirms(self):
        prober = _RecordingProber({_URL1: 0, _URL2: 200})
        out = C.disambiguate(self._candidates(_KEY, [_URL1, _URL2]), prober)
        self.assertEqual(_URL2, out[0].base_url)
        self.assertEqual(CONFIDENCE_MEDIUM, out[0].confidence)

    def test_server_error_is_inconclusive_then_confirms(self):
        prober = _RecordingProber({_URL1: 503, _URL2: 403})
        out = C.disambiguate(self._candidates(_KEY, [_URL1, _URL2]), prober)
        self.assertEqual(_URL2, out[0].base_url)
        self.assertEqual(CONFIDENCE_MEDIUM, out[0].confidence)

    def test_all_401_keeps_the_first_candidate_low(self):
        prober = _RecordingProber({_URL1: 401, _URL2: 401})
        out = C.disambiguate(self._candidates(_KEY, [_URL1, _URL2]), prober)
        self.assertEqual(1, len(out))
        self.assertEqual(CONFIDENCE_LOW, out[0].confidence)

    def test_request_count_is_capped(self):
        urls = [f"https://h{i}.example.test/v1" for i in range(PAIR_DISAMBIG_MAX_CANDIDATES + 4)]
        prober = _RecordingProber({u: 401 for u in urls})
        C.disambiguate(self._candidates(_KEY, urls), prober)
        self.assertEqual(PAIR_DISAMBIG_MAX_CANDIDATES, len(prober.calls))

    def test_prober_none_collapses_to_one_representative(self):
        out = C.disambiguate(self._candidates(_KEY, [_URL1, _URL2]), None)
        self.assertEqual(1, len(out))
        self.assertEqual(CONFIDENCE_LOW, out[0].confidence)

    def test_high_and_medium_pass_through_untouched(self):
        high = CredentialPair(key=_KEY, base_url=_URL1, confidence=CONFIDENCE_HIGH, evidence="same line")
        lone_low = CredentialPair(key=_KEY, base_url=_URL2, confidence=CONFIDENCE_LOW, evidence="x")
        prober = _RecordingProber({})
        out = C.disambiguate([high, lone_low], prober)
        self.assertEqual(2, len(out))
        self.assertEqual([], prober.calls)

    def test_prober_exception_is_not_fatal(self):
        prober = _RecordingProber({_URL1: None, _URL2: 200}, raise_on={_URL1})
        out = C.disambiguate(self._candidates(_KEY, [_URL1, _URL2]), prober)
        self.assertEqual(_URL2, out[0].base_url)


class ExtractorEndToEndTests(unittest.TestCase):
    def test_d6_reply_visible_leak_is_extracted_as_aggregator_leak(self):
        body = fixtures.load("linux_sb_credentials_d6")["reply_visible_leak_fake"]
        post = _post(body, tid=23295)
        pairs = C.LayeredExtractor().extract(post)
        self.assertEqual(1, len(pairs))
        self.assertEqual("https://asvla.bbqwq.com/", pairs[0].base_url)
        self.assertEqual(KEY_SOURCE_AGGREGATOR_LEAK, pairs[0].origin)
        self.assertEqual(23295, pairs[0].source_tid)

    def test_ordinary_post_pair_is_post_origin(self):
        post = _post(f"{_URL1}\n{_KEY}")
        pairs = C.LayeredExtractor().extract(post)
        self.assertEqual(1, len(pairs))
        self.assertEqual(KEY_SOURCE_POST, pairs[0].origin)

    def test_extractor_without_prober_collapses_low_candidates(self):
        post = _post(f"{_KEY}\n{_URL1}\n{_URL2}")
        pairs = C.LayeredExtractor().extract(post)  # no prober
        self.assertEqual(1, len(pairs))
        self.assertEqual(CONFIDENCE_LOW, pairs[0].confidence)

    def test_extractor_with_prober_disambiguates(self):
        post = _post(f"{_KEY}\n{_URL1}\n{_URL2}")
        pairs = C.LayeredExtractor(prober=_RecordingProber({_URL1: 401, _URL2: 200})).extract(post)
        self.assertEqual(1, len(pairs))
        self.assertEqual(_URL2, pairs[0].base_url)
        self.assertEqual(CONFIDENCE_MEDIUM, pairs[0].confidence)

    def test_provider_stamped_on_pair(self):
        token = _vendor("sk-or-v1-")
        post = _post(f"endpoint {_URL1} token {token}")
        pairs = C.LayeredExtractor().extract(post)
        self.assertEqual("openrouter.ai", pairs[0].provider)
        self.assertEqual(_URL1, pairs[0].base_url)

    def test_d6_samples_all_extract_and_pair(self):
        d6 = fixtures.load("linux_sb_credentials_d6")
        for s in d6["samples"]:
            body = f"{s['base_url']}\n{s['fake_key']}"
            pairs = C.LayeredExtractor().extract(_post(body, tid=s["tid"]))
            self.assertEqual(1, len(pairs), s["tid"])
            self.assertIn(s["fake_key"], C.find_credentials(body))
            self.assertEqual(s["base_url"].rstrip(), pairs[0].base_url.rstrip())

    def test_jsonld_fixture_body_pairs_end_to_end(self):
        # The credential-bearing body is the json_ld_credential_beyond_truncation
        # variant (the plain json_ld node only shows the @graph shape). Select the
        # DiscussionForumPosting node whose articleBody actually holds the key, so
        # this replays 07 §四 step 2: the enriched body beats the 200-char cut.
        fix = fixtures.load("linux_sb_jsonld_graph")
        line = fix["expected"]["credential_line"]
        body = ""
        for variant in ("json_ld", "json_ld_credential_beyond_truncation"):
            for node in fix[variant]["@graph"]:
                if node.get("@type") == interfaces.JSONLD_POSTING_TYPE and line["key"] in node.get("articleBody", ""):
                    body = node["articleBody"]
        self.assertTrue(body, "no @graph node carries the expected credential")
        pairs = C.LayeredExtractor().extract(_post(body, tid=23295))
        self.assertEqual(1, len(pairs))
        self.assertEqual(line["key"], pairs[0].key)
        self.assertEqual(line["base_url"], pairs[0].base_url)
        # The fixture notes "high", but 07 §8.2 reserves high for a key and its
        # URL sharing one LINE / code block / JSON object / table row *inside the
        # shared text*; here they are adjacent lines, so the table says medium
        # (行距 <= 3). The extractor follows 07 verbatim, not the fixture's
        # whole-object framing. (Flagged as a CONTRACT-ISSUE in credentials.py.)
        self.assertEqual(CONFIDENCE_MEDIUM, pairs[0].confidence)

    def test_base64_obfuscated_link_is_a_recall_limit(self):
        # 02 §D.2: a link may be base64-wrapped; the http regex misses it, so the
        # credential has no candidate endpoint and is dropped (not a false pair).
        encoded = base64.b64encode(_URL1.encode()).decode()
        self.assertNotIn(_URL1, C.find_urls(encoded))
        pairs = C.LayeredExtractor().extract(_post(f"{encoded}\n{_KEY}"))
        self.assertEqual([], pairs)


class RedLineTests(unittest.TestCase):
    def test_evidence_never_contains_the_plaintext_key(self):
        for body in (f"{_URL1}\n{_KEY}", f"{_KEY}\n{_URL1}\n{_URL2}",
                     f"{_CODE_FENCE}\n{_URL1}\n{_KEY}\n{_CODE_FENCE}"):
            for p in C.LayeredExtractor().extract(_post(body)):
                self.assertNotIn(p.key, p.evidence)
                self.assertNotIn(p.key, repr(p))

    def test_triplet_mask_hash_encrypt(self):
        pair = CredentialPair(key=_relay_key("a" * 60), base_url=_URL1)
        fernet = crypto.generate_fernet_key()
        tri = C.crypto_triplet(pair, fernet)
        self.assertEqual(crypto.mask(pair.key), tri["masked"])
        self.assertEqual(crypto.sha256_hex(pair.key), tri["hash"])
        self.assertEqual(pair.key, crypto.decrypt_secret(tri["encrypted"], fernet))
        self.assertNotIn(pair.key, tri["masked"])

    def test_triplet_without_key_never_encrypts_plaintext(self):
        pair = CredentialPair(key=_relay_key(), base_url=_URL1)
        self.assertEqual("", C.crypto_triplet(pair)["encrypted"])

    def test_repr_masks_the_key(self):
        pair = CredentialPair(key=_relay_key("a" * 40), base_url=_URL1)
        self.assertNotIn(pair.key, repr(pair))
        self.assertIn(pair.mask(), repr(pair))


class MainStoreIntegrationTests(unittest.TestCase):
    """Prove ``CredentialPair`` output satisfies ``main``'s real store writer.

    This drives ``main._store_credential`` (the skeleton's own B-pair writer) on
    an in-memory DB with a generated Fernet key - no network, no ``crawler/data``.
    It is the contract-level guarantee that an extractor pair stores masked +
    hashed + Fernet-encrypted with the plaintext key never landing in the row
    (07 §8.4 / §8.5)."""

    def setUp(self):
        import main
        from config import AppConfig
        from store import db
        self.main = main
        self.db = db
        self.AppConfig = AppConfig
        self.key = _relay_key("a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0")
        self.url = "https://asvla.bbqwq.com/"
        body = f"{self.url}\n{self.key}"
        raw = RawPost(tid=23295, title="relay", forum_id=2, forum_name="福利放送",
                      author_name="pdd", url="https://linux.sb/topic/23295",
                      content_text=body)
        full = FullPost(raw=raw, article_body=body, enriched=True)
        from interfaces import ClassifiedPost
        self.item = ClassifiedPost(post=full, category="B", matched_rule="B")
        self.pairs = C.LayeredExtractor().extract(full)
        self.cfg = self.AppConfig(agg_api_base="x", ua="x", forums=[2], db_path=":memory:",
                                  dingtalk_webhook="", enable_paid_probe=False,
                                  enable_account_farm=False,
                                  fernet_key=crypto.generate_fernet_key().decode())

    def test_extractor_emits_one_medium_pair(self):
        self.assertEqual(1, len(self.pairs))
        self.assertEqual(CONFIDENCE_MEDIUM, self.pairs[0].confidence)
        self.assertEqual(self.url, self.pairs[0].base_url)

    def test_pair_stores_masked_hashed_and_encrypted_only(self):
        conn = self.db.connect_in_memory()
        self.db.init_db(conn)
        try:
            cid = self.main._store_credential(conn, self.cfg, self.item, self.pairs[0])
            row = self.db.get_token_key(conn, cid)
            self.assertEqual(crypto.mask(self.key), row["key_masked"])
            self.assertEqual(crypto.sha256_hex(self.key), row["key_hash"])
            self.assertEqual(self.url, row["base_url"])
            self.assertEqual(CONFIDENCE_MEDIUM, row["confidence"])
            # the only lawful home of the plaintext is the Fernet ciphertext.
            self.assertTrue(row["key_encrypted"].startswith("gAAAAA"))
            self.assertEqual(self.key,
                             crypto.decrypt_secret(row["key_encrypted"], self.cfg.fernet_key))
            # no plaintext anywhere in the stored rows (07 §8.5).
            blob = " ".join(str(v) for r in conn.execute("SELECT * FROM token_keys") for v in r)
            self.assertNotIn(self.key, blob)
        finally:
            conn.close()

    def test_missing_fernet_key_never_stores_plaintext(self):
        # 07 §8.5: FERNET_KEY unset -> the writer raises (upstream degrades the
        # row) instead of falling back to plaintext; my pair must not force a
        # clear-text write through crypto_triplet either.
        self.assertEqual("", C.crypto_triplet(self.pairs[0])["encrypted"])


class _CycleFakeAdapter:
    source_id = "linux_sb"

    def __init__(self, raw):
        self._raw = raw

    def discover(self, since_tid):
        return [self._raw]

    def enrich(self, post):
        return FullPost(raw=post, article_body=post.content_text, enriched=True)

    def classify_rules(self):
        return []


class _CycleFakeClassifier:
    def register(self, rules):
        pass

    def classify(self, full):
        return ClassifiedPost(post=full, category=CATEGORY_B, matched_rule="B")


class _CycleFakeProber(interfaces.Prober):
    def probe(self, pair):
        return ProbeOutcome(credential_id="c", base_url=pair.base_url,
                            probe_kind="models", http_status=200,
                            verdict="valid", probed_at=1)


class _CycleFakeMachine(interfaces.VerdictMachine):
    def next(self, previous, outcome):
        return VerdictDecision(verdict="valid", consecutive_failures=0)


class _CycleStubWriter:
    def build(self, *args, **kwargs):
        return ""

    def write(self, *args, **kwargs):
        return ""


class _CycleFakeAlerter:
    def notify(self, msg):
        return False


class RunCycleIntegrationTests(unittest.TestCase):
    """Drive ``main.run_cycle`` end to end with only the OTHER owners' stages
    faked (network discovery / probe / verdict / publish) and my ``LayeredExtractor``
    real, to show the extract stage integrates without raising into the cycle and
    produces a fully-encrypted row. This is the network-free stand-in for the live
    ``python crawler/main.py --once`` path, which the sandbox blocks on external
    HTTP."""

    def test_extract_stage_integrates_into_run_cycle(self):
        import main
        from config import AppConfig
        from store import db
        key = _relay_key("a1b2c3d4e5f6g7h8i9j0a1b2c3d4e5f6g7h8i9j0")
        url = "https://asvla.bbqwq.com/"
        body = f"中转站：\n{url}\n{key}\n"
        raw = RawPost(tid=23531, title="relay share", forum_id=2, forum_name="福利放送",
                      author_name="pdd", url="https://linux.sb/topic/23531",
                      content_text=body)
        cfg = AppConfig(agg_api_base="x", ua="x", forums=[2], db_path=":memory:",
                        dingtalk_webhook="", enable_paid_probe=False,
                        enable_account_farm=False,
                        fernet_key=crypto.generate_fernet_key().decode(), dry_run=False)
        conn = db.connect_in_memory()
        db.init_db(conn)
        components = {
            "adapter": _CycleFakeAdapter(raw),
            "classifier": _CycleFakeClassifier(),
            "extractor": C.LayeredExtractor(cfg),
            "prober": _CycleFakeProber(),
            "machine": _CycleFakeMachine(),
            "feed": _CycleStubWriter(),
            "reporter": _CycleStubWriter(),
            "alerter": _CycleFakeAlerter(),
        }
        try:
            result = main.run_cycle(cfg, conn=conn, components=components)
            self.assertEqual(1, result.credentials)
            self.assertEqual(1, result.stored_keys)
            self.assertEqual([], result.pending)
            rows = list(conn.execute(
                "SELECT key_masked, base_url, confidence, key_encrypted FROM token_keys"))
            self.assertEqual(1, len(rows))
            self.assertEqual(url, rows[0]["base_url"])
            self.assertNotIn(key, rows[0]["key_masked"])
            self.assertTrue(rows[0]["key_encrypted"].startswith("gAAAAA"))
            blob = " ".join(str(v) for r in conn.execute("SELECT * FROM token_keys") for v in r)
            self.assertNotIn(key, blob)
        finally:
            conn.close()


class ContractFidelityTests(unittest.TestCase):
    """The module must reuse the shared patterns; retyping them breaks §8.1 counts."""

    def test_shared_constants_are_imported_verbatim(self):
        source = _read_module_source()
        for token in ("PRIMARY_CREDENTIAL_RE", "GENERIC_CREDENTIAL_RE", "GOOGLE_CREDENTIAL_RE",
                      "PREFIX_BASE_URL_HINTS"):
            self.assertIn(token, source)

    def test_module_defines_no_own_credential_pattern(self):
        source = _read_module_source()
        # The verbatim primary pattern must not be duplicated into this module.
        self.assertNotIn("(?<![A-Za-z0-9_\\-])(?:sk-", source)
        for prefix in ("gsk_", "xai-", "fw_", "AIza", "sk-or-v1", "sk-ant"):
            self.assertNotIn(prefix, source)

    def test_prober_contract_is_honoured(self):
        # Disambiguation calls prober.probe(pair) and reads http_status only
        # (the probe ladder / verdict machine belong to P0-6). A multi-candidate
        # low pairing is what triggers the probe; it receives the CredentialPair
        # and its base_url is the endpoint under test.
        candidates = C.pair([_KEY], [_URL1, _URL2], f"{_KEY}\n{_URL1}\n{_URL2}")
        self.assertEqual(CONFIDENCE_LOW, candidates[0].confidence)
        seen = _ProbeSpy()
        out = C.disambiguate(candidates, seen)
        self.assertEqual(1, len(out))
        self.assertIsInstance(seen.last, CredentialPair)
        self.assertTrue(seen.calls and all(c.startswith("https://") for c in seen.calls))

    def test_lone_low_pair_is_never_probed(self):
        # One low candidate has nothing to disambiguate -> zero requests (07 §8.3
        # "绝不判失效" only concerns real probing; here we simply do not probe).
        lone = CredentialPair(key=_KEY, base_url=_URL1, confidence=CONFIDENCE_LOW, evidence="one URL, 2 keys")
        spy = _ProbeSpy()
        out = C.disambiguate([lone], spy)
        self.assertEqual([], spy.calls)
        self.assertEqual([lone], out)


class ForbiddenBypassTests(unittest.TestCase):
    """07 §5.3 / D2 铁律: the extractor must never try a login / POST / gate bypass."""

    FORBIDDEN_SUBSTRINGS = (
        "login", "password", "passwd", "cookie", "signin", "sign-in", "credential_post",
        ".post(", "POST ", "POST(", "session", "requests.", "urllib.request", "http.client",
        "import socket", "httpx", "aiohttp", "Authorization:", "anthropic",
    )
    ALLOWED_IMPORT_ROOTS = {"re", "typing", "interfaces", "crypto", "__future__"}

    def test_credentials_module_has_no_bypass_or_network_logic(self):
        source = _read_module_source()
        hits = [needle for needle in self.FORBIDDEN_SUBSTRINGS if needle in source]
        self.assertEqual([], hits, f"extract/credentials.py must not contain {hits}")

    def test_credentials_module_imports_only_the_whitelisted_roots(self):
        tree = ast.parse(_read_module_source())
        roots = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                roots.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.level == 0 and node.module:
                    roots.add(node.module.split(".")[0])
        self.assertTrue(roots.issubset(self.ALLOWED_IMPORT_ROOTS), roots)

    def test_forbidden_patterns_are_self_tested(self):
        # The scan above is meaningful: each forbidden token is caught when present,
        # the real module is clean, and the red-line regex really matches a
        # vendor-shaped key (built at runtime, so this file stays scanner-clean).
        for needle in self.FORBIDDEN_SUBSTRINGS:
            self.assertIn(needle, f"dummy {needle} here")
        self.assertFalse(any(n in _read_module_source() for n in self.FORBIDDEN_SUBSTRINGS))
        vendor_token = _vendor("gsk_", "a1b2c3d4e5f6")
        self.assertTrue(re.search(interfaces.PRIMARY_CREDENTIAL_RE, vendor_token))


def _read_module_source() -> str:
    with open(CREDENTIALS_MODULE, "r", encoding="utf-8") as fh:
        return fh.read()


class _ProbeSpy(interfaces.Prober):
    """Records the CredentialPair objects it is handed, answers 200 once."""

    def __init__(self):
        self.calls: list = []
        self.last = None

    def probe(self, pair: CredentialPair) -> ProbeOutcome:
        self.last = pair
        self.calls.append(pair.base_url)
        return ProbeOutcome(credential_id="spy", base_url=pair.base_url,
                            probe_kind="models", http_status=200, verdict="valid")


class _RecordingProber(interfaces.Prober):
    def __init__(self, statuses, raise_on=None):
        self.statuses = dict(statuses)
        self.raise_on = set(raise_on or ())
        self.calls = []

    def probe(self, pair: CredentialPair) -> ProbeOutcome:
        self.calls.append(pair.base_url)
        if pair.base_url in self.raise_on:
            raise ConnectionError("simulated transport error")
        status = self.statuses.get(pair.base_url, 0)
        return ProbeOutcome(
            credential_id=f"cred-{pair.base_url}",
            base_url=pair.base_url,
            probe_kind="models",
            http_status=status,
            verdict="valid" if 200 <= status < 300 else "unknown",
        )


if __name__ == "__main__":
    unittest.main()
