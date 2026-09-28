"""Source-adapter base contract (07 5.2 ``sources/base.py``, D10).

The ``SourceAdapter`` ABC itself is declared in :mod:`interfaces` so that all
cross-module contracts live in one read-only file. This module re-exports it
(and the payload types) so a source implementer can write
``from sources.base import SourceAdapter`` and nothing else changes.

Adding a second forum source (the reason D10 exists) means dropping one new file
into ``sources/`` that subclasses ``SourceAdapter`` and registers its own
classify rules - no edit to ``classify/``, ``extract/``, ``probe/``, ``store/``
or ``main.py`` beyond one line in ``main.build_pipeline``.
"""
from __future__ import annotations

from interfaces import (
    FINGERPRINT_LEN,
    FullPost,
    RawPost,
    SourceAdapter,
    TRUNCATED_BODY_LEN,
)

__all__ = [
    "SourceAdapter",
    "RawPost",
    "FullPost",
    "FINGERPRINT_LEN",
    "TRUNCATED_BODY_LEN",
    "dedupe_by_fingerprint",
]


def dedupe_by_fingerprint(posts):
    """Drop posts whose body fingerprint was already seen in this batch.

    07 4 step #1: "正文前40字符指纹去重". Shared helper so every source adapter
    dedupes identically (D10).
    """
    seen = set()
    unique = []
    for post in posts:
        fp = post.fingerprint()
        if fp and fp in seen:
            continue
        seen.add(fp)
        unique.append(post)
    return unique
