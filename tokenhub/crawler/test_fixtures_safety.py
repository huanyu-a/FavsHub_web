"""Safety + provenance tests for the fixtures (07 §8.5 red line, task item 7).

Two jobs:

1. Provenance - the fixtures must actually contain the 02-verbatim strings the
   plan says they mirror (23217 reply-gate tail, the virtual-card D fragment, the
   JSON-LD ``@graph`` structure), so a reviewer can trust them as replay inputs.

2. The red line - no credential-shaped string anywhere under ``crawler/`` may
   exist unless it starts with ``sk-TESTFAKE``. This walks the whole tree, so it
   also guards the three other developers' packages as they land (07 §8.5).
"""
from __future__ import annotations

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import interfaces  # noqa: E402
from fixtures import FAKE_KEY_PREFIX, assert_fake_keys, load, load_all, names  # noqa: E402

CRAWLER_ROOT = os.path.dirname(os.path.abspath(interfaces.__file__))

# Credential shapes (07 §8.2) as compiled patterns, for the repo-wide scan.
_SHAPES = [
    re.compile(interfaces.PRIMARY_CREDENTIAL_RE),
    re.compile(interfaces.GENERIC_CREDENTIAL_RE),
    re.compile(interfaces.GOOGLE_CREDENTIAL_RE),
]


class ProvenanceTests(unittest.TestCase):
    def test_expected_fixtures_present(self):
        for want in ("linux_sb_23217", "linux_sb_virtual_card",
                     "linux_sb_jsonld_graph", "linux_sb_credentials_d6",
                     "probe_response_table"):
            self.assertIn(want, names(), want)

    def test_23217_reply_gate_verbatim(self):
        tail = load("linux_sb_23217")["article_body_tail"]
        # 02 A.5: the exact server-injected placeholder tail.
        self.assertIn("🔒回复后可见", tail)
        self.assertIn("回复本主题后即可查看这部分内容。", tail)
        self.assertTrue(load("linux_sb_23217")["reply_visible_locked"])

    def test_virtual_card_fragment_verbatim(self):
        card = load("linux_sb_virtual_card")["card_html"]
        self.assertIn("virtual-card-kicker", card)
        self.assertIn("积分兑换", card)
        self.assertIn("库存 292", card)
        badge = load("linux_sb_virtual_card")["list_badge_html"]
        self.assertIn("发卡中", badge)

    def test_jsonld_graph_structure(self):
        graph = load("linux_sb_jsonld_graph")["json_ld"]["@graph"]
        posting = [n for n in graph if n.get("@type") == interfaces.JSONLD_POSTING_TYPE]
        self.assertTrue(posting, "no DiscussionForumPosting node in @graph")
        self.assertIn("articleBody", posting[0])


class ContractSmokeTests(unittest.TestCase):
    """The 07 §8.1 constants must fire on the real 02 strings.

    Not a classifier test - just proof the shared regex/marker constants have
    not drifted from the corpus the measured precision came from.
    """

    def test_c_class_regex_matches_gate(self):
        tail = load("linux_sb_23217")["article_body_tail"]
        self.assertTrue(re.search(interfaces.C_CLASS_RE, tail))

    def test_d_badge_marker_in_card(self):
        # The list-view badge (02 A.6) is what carries virtual-card-title-status;
        # the post-body card fragment is the price box. Either DOM marker classifies D.
        card = load("linux_sb_virtual_card")
        markers = interfaces.D_BADGE_MARKERS
        self.assertTrue(any(m in card["list_badge_html"] for m in markers))

    def test_generic_regex_matches_fake_d6_key(self):
        sample = load("linux_sb_credentials_d6")["samples"][0]["fake_key"]
        # The generic 07 §8.2 pattern catches sk- prefixed keys of any tail.
        self.assertTrue(re.search(interfaces.GENERIC_CREDENTIAL_RE, sample))


class FakeKeyInvariantTests(unittest.TestCase):
    def test_no_real_credentials_in_fixtures(self):
        offenders = assert_fake_keys()
        self.assertEqual(offenders, [], offenders)

    def test_d6_fake_keys_are_fully_testfake(self):
        for s in load("linux_sb_credentials_d6")["samples"]:
            self.assertTrue(s["fake_key"].startswith(FAKE_KEY_PREFIX), s["fake_key"][:16])
            # 02 only ever recorded masked forms, so the quoted shape stays truncated.
            self.assertIn("…", s["masked_form_quoted"])


class RepositoryRedLineTests(unittest.TestCase):
    """Every credential-shaped string in the whole crawler tree must be fake."""

    def _files(self):
        skip_dirs = {"__pycache__", "data"}
        for root, dirs, files in os.walk(CRAWLER_ROOT):
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for fn in files:
                if fn.endswith((".py", ".json", ".md", ".txt", ".example")):
                    yield os.path.join(root, fn)

    def test_no_plaintext_credentials_anywhere(self):
        offenders = []
        for path in self._files():
            with open(path, "r", encoding="utf-8") as fh:
                text = fh.read()
            for rx in _SHAPES:
                for hit in rx.findall(text):
                    if not hit.startswith(FAKE_KEY_PREFIX):
                        offenders.append(f"{os.path.relpath(path, CRAWLER_ROOT)}: {hit[:16]}...")
        self.assertEqual(offenders, [], offenders)


if __name__ == "__main__":
    unittest.main()
