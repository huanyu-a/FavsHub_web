"""RSS 2.0 feed generation (07 §5.2 ``publish/feed.py``, P0-8, red lines §8.5).

Owner: publisher owner. Contract stub - signature complete, body raises
``NotImplementedError``.

07 requirements this stub is the checklist for:
  * RSS 2.0, regenerated in full every cycle from ``store.db.select_publishable``
    (07 §四 ⑦ "每轮全量重算快照"), written atomically (07 §5.2 "原子写");
  * ``dead`` rows excluded, ``hidden`` rows excluded (07 D3 / D12 - already
    filtered by the query, do not re-add them here);
  * **never a plaintext key** (07 §8.5 rule 1). ``key_masked`` / verdict /
    confidence / source link only. C-class rows publish the guide text and the
    original post link, with an empty ``key_masked`` (07 D2);
  * ``error_message_raw`` is audit-only and must never be rendered (07 §8.5
    rule 3);
  * a disclaimer sentence per item is welcome but the mandatory disclaimer lives
    on the P1 page (07 D12).
"""
from __future__ import annotations

import os
import tempfile
from typing import Sequence

from interfaces import FeedBuilder, FeedEntry

#: Feed channel metadata. The public URL is only fixed at P1 (07 §6.2 C4:
#: host nginx alias ``/tokens/feed.xml``), so it is passed in, not hardcoded.
FEED_TITLE = "tokenhub 福利 key 快照"
FEED_LINK = "https://hao.bx9y.com.cn/tokens/keys"
FEED_DESCRIPTION = (
    "来自第三方论坛公开帖的 API 凭证快照，仅脱敏展示（前6+后4）+ 存活状态；"
    "内容仅供测试，如有侵权请联系删除。dead 状态不进本 feed。"
)

#: 07 §8.5: the disclaimer wording that must travel with published content.
DISCLAIMER = "内容来自第三方论坛公开帖，仅供测试，如有侵权请联系删除。"


def escape(text: str) -> str:
    """XML-escape a value for feed content.

    ``xml.sax.saxutils.escape`` is the stdlib choice (07 §一 stdlib-only rule);
    titles and forum bodies contain ``&``, ``<`` and emoji freely.
    """
    raise NotImplementedError("P0-8: implement XML escaping")


class RssFeed(FeedBuilder):
    """Feed writer bound to ``cfg.feed_path``."""

    def __init__(self, cfg=None, path: str = "", link: str = FEED_LINK):
        self.cfg = cfg
        #: Explicit ``path`` wins so tests can write into a temp directory.
        self.path = path or (cfg.feed_path if cfg is not None else "")
        self.link = link

    def build(self, entries: Sequence[FeedEntry]) -> str:
        """Serialise the snapshot into RSS 2.0 XML text."""
        raise NotImplementedError("P0-8: implement the RSS 2.0 writer")

    def write(self, xml: str) -> str:
        """Atomically replace ``self.path`` (temp file + ``os.replace``).

        The cron job rewrites the whole feed every 3 hours while nginx serves it
        statically, so a half-written file would be fetched by real subscribers -
        hence the atomic replace is part of the contract, not an optimisation.
        """
        raise NotImplementedError("P0-8: implement the atomic write")
