"""RSS 2.0 feed generation (07 §5.2 ``publish/feed.py``, P0-8, red lines §8.5).

Owner: publisher owner. IMPLEMENTED for P0-8 (signatures and the contract
constraints below unchanged).

07 requirements this implementation follows:
  * RSS 2.0, regenerated in full every cycle from ``store.db.select_publishable``
    (07 §四 ⑦ "每轮全量重算快照"), written atomically (07 §5.2 "原子写");
  * ``dead`` rows excluded, ``hidden`` rows excluded (07 D3 / D12 - already
    filtered by the query, kept as a defensive no-op skip here because
    :class:`interfaces.FeedEntry` carries ``verdict``);
  * **never a plaintext key** (07 §8.5 rule 1). ``key_masked`` / verdict /
    confidence / source link only. C-class rows publish the guide text and the
    original post link, with an empty ``key_masked`` (07 D2);
  * ``error_message_raw`` is audit-only and must never be rendered (07 §8.5
    rule 3) - this module never sees it: its input is a masked
    :class:`interfaces.FeedEntry`, and the rendered text is scrubbed once more
    through :func:`alert.scrub` so a credential-shaped title/body cannot leak;
  * the D12 disclaimer travels on the channel and on every item.
"""
from __future__ import annotations

import os
import re
import tempfile
import time
from email.utils import formatdate
from typing import List, Sequence
from xml.sax.saxutils import escape as _xml_escape

from interfaces import FeedBuilder, FeedEntry, VERDICT_DEAD

#: Characters XML 1.0 forbids outright (Char ::= #x9 | #xA | #xD | [#x20-#xD7FF]
#: | [#xE000-#xFFFD] | [#x10000-#x10FFFF]): most C0 control chars, lone
#: surrogates and the noncharacters U+FFFE/U+FFFF. Forum titles/bodies are
#: untrusted input, so escape() drops them instead of emitting a feed no XML
#: parser can read (one \x0b in a title would otherwise break the whole file).
_XML_INVALID_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")

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
    titles and forum bodies contain ``&``, ``<`` and emoji freely. Characters
    XML 1.0 cannot represent at all (control chars, lone surrogates,
    U+FFFE/U+FFFF) are stripped first, so the output always parses.
    """
    return _xml_escape(_XML_INVALID_RE.sub("", text or ""))


def _rfc822(ts: int) -> str:
    """RFC 822 date (RSS 2.0 ``pubDate`` / ``lastBuildDate``)."""
    try:
        return formatdate(int(ts) if int(ts) > 0 else None, localtime=True)
    except (TypeError, ValueError, OverflowError):
        return formatdate(None, localtime=True)


def entry_text(entry: FeedEntry) -> str:
    """Masked-level body of one item (07 §8.5 rule 1: this is the ceiling).

    C-class rows (D2) render the claim instruction and no key column at all;
    B-class rows render the masked key, verdict, confidence and endpoint. The
    plaintext key is structurally absent - :class:`interfaces.FeedEntry` has no
    field that could carry it.
    """
    if getattr(entry, "guide_text", ""):
        return f"{entry.guide_text}\n{DISCLAIMER}"
    parts: List[str] = []
    if entry.provider:
        parts.append(f"provider: {entry.provider}")
    if entry.base_url:
        parts.append(f"base_url: {entry.base_url}")
    if entry.key_masked:
        parts.append(f"key: {entry.key_masked}")
    parts.append(f"verdict: {entry.verdict}")
    parts.append(f"confidence: {entry.confidence}")
    parts.append(DISCLAIMER)
    return "\n".join(parts)


def entry_title(entry: FeedEntry) -> str:
    """Item title: the post title, or a stable fallback when it is empty."""
    title = (getattr(entry, "title", "") or "").strip()
    if title:
        return title
    return f"[{entry.category}] {entry.source_id}#{entry.source_tid}"


class RssFeed(FeedBuilder):
    """Feed writer bound to ``cfg.feed_path``."""

    def __init__(self, cfg=None, path: str = "", link: str = FEED_LINK):
        self.cfg = cfg
        #: Explicit ``path`` wins so tests can write into a temp directory.
        self.path = path or (cfg.feed_path if cfg is not None else "")
        self.link = link

    def build(self, entries: Sequence[FeedEntry]) -> str:
        """Serialise the snapshot into RSS 2.0 XML text.

        D3 defensively re-checked (the store query already drops ``dead``):
        an entry marked ``dead`` never reaches the channel. Item order is the
        caller's (``select_publishable`` orders by ``first_seen_at DESC``).
        """
        import alert  # local import: alert.py owns the outbound red-line scrub

        safe_entries = [
            entry for entry in entries
            if (getattr(entry, "verdict", "") or "") != VERDICT_DEAD
        ]
        build_ts = int(time.time())
        lines: List[str] = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0">',
            "  <channel>",
            f"    <title>{escape(FEED_TITLE)}</title>",
            f"    <link>{escape(self.link)}</link>",
            f"    <description>{escape(FEED_DESCRIPTION)}</description>",
            "    <language>zh-cn</language>",
            f"    <lastBuildDate>{escape(_rfc822(build_ts))}</lastBuildDate>",
            "    <generator>tokenhub-crawler P0 (07 §5.1 P0-8)</generator>",
            f"    <category>{escape(DISCLAIMER)}</category>",
        ]
        for entry in safe_entries:
            description = alert.scrub(entry_text(entry))
            title = alert.scrub(entry_title(entry))
            permalink = entry.source_url.startswith("http://") or entry.source_url.startswith("https://")
            guid = entry.source_url if permalink else f"{entry.source_id}:{entry.source_tid}"
            lines.append("    <item>")
            lines.append(f"      <title>{escape(title)}</title>")
            lines.append(f"      <link>{escape(entry.source_url)}</link>")
            lines.append(
                f'      <guid isPermaLink="{"true" if permalink else "false"}">'
                f"{escape(guid)}</guid>"
            )
            lines.append(f"      <description>{escape(description)}</description>")
            published = int(getattr(entry, "published_at", 0) or 0)
            lines.append(f"      <pubDate>{escape(_rfc822(published))}</pubDate>")
            lines.append(f"      <category>{escape(entry.category)}</category>")
            lines.append("    </item>")
        lines.append("  </channel>")
        lines.append("</rss>")
        lines.append("")
        return "\n".join(lines)

    def write(self, xml: str) -> str:
        """Atomically replace ``self.path`` (temp file + ``os.replace``).

        The cron job rewrites the whole feed every 3 hours while nginx serves it
        statically, so a half-written file would be fetched by real subscribers -
        hence the atomic replace is part of the contract, not an optimisation.
        """
        if not self.path:
            raise ValueError("RssFeed.write: no feed path configured")
        directory = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(directory, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".feed-", suffix=".xml")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(xml)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, self.path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
        return self.path
