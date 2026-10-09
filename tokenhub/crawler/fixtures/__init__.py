"""Fake fixtures for tests (07 §8.5 red line: no real credentials, ever).

OWNERSHIP: skeleton author. Read-only for every implementer.

Every string here is either
  * transcribed from ``docs/02-前期侦察实测证据.md`` (the sections cited per
    fixture), or
  * a fabrication whose credential part always starts with ``sk-TESTFAKE``.

No real credential is stored anywhere in this repository - 02 §D.6 only recorded
masked forms (first 6 chars + length), and those prefixes are reproduced here
with fabricated tails of the same length. The ``provenance`` key of each fixture
says exactly which part is quoted and which is fabricated, so a reviewer can
check the claim.

Usage::

    from fixtures import load
    sample = load("linux_sb_23217")          # dict
    text = load("linux_sb_23217")["article_body_tail"]
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List

FIXTURE_DIR = os.path.dirname(os.path.abspath(__file__))

#: The only credential prefix allowed in this repo (07 §8.5, task red line).
FAKE_KEY_PREFIX = "sk-TESTFAKE"

__all__ = ["FIXTURE_DIR", "FAKE_KEY_PREFIX", "names", "load", "load_all",
           "assert_fake_keys"]


def names() -> List[str]:
    """Fixture names (file stem without ``.json``)."""
    return sorted(
        f[:-len(".json")]
        for f in os.listdir(FIXTURE_DIR)
        if f.endswith(".json")
    )


def load(name: str) -> Dict[str, Any]:
    """Read one fixture JSON as a dict."""
    path = os.path.join(FIXTURE_DIR, name + ".json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_all() -> Dict[str, Dict[str, Any]]:
    """Every fixture, keyed by name (used by the safety test)."""
    return {name: load(name) for name in names()}


def assert_fake_keys(obj: Any = None, path: str = "") -> List[str]:
    """Return the list of ``key``-shaped values that are NOT fake.

    The safety test asserts this returns an empty list: any credential-shaped
    string inside ``fixtures/`` must start with :data:`FAKE_KEY_PREFIX`
    (07 §8.5 - a real leaked key must never enter the repository, tests or
    fixtures included).
    """
    import re

    # Anything that looks like a credential (07 §8.2 generic shape).
    shape = re.compile(r"sk-[A-Za-z0-9_\-]{10,220}|\bAIza[0-9A-Za-z_\-]{35}\b")
    offenders: List[str] = []

    def walk(node: Any, where: str) -> None:
        if isinstance(node, str):
            for hit in shape.findall(node):
                if not hit.startswith(FAKE_KEY_PREFIX):
                    offenders.append(f"{where}: {hit[:12]}...")
        elif isinstance(node, dict):
            for key, value in node.items():
                walk(value, f"{where}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{where}[{index}]")

    walk(obj if obj is not None else load_all(), path or "fixtures")
    return offenders
