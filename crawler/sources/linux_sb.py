"""linux.sb source adapter (07 §5.2 ``sources/linux_sb.py``; P0-2 discovery / P0-3 enrichment).

Owner: sources implementer (A). The class implements the read-only
:class:`interfaces.SourceAdapter` contract; nothing here changes it.

CONTRACT-ISSUE (report only, not patched here - ARCHITECTURE 2.1): 07 5.4 6 and
ARCHITECTURE 3.2 require the sitemap fallback switch to fire
``alerter.notify()``, but the skeleton's ``main.build_components`` (main.py:114)
constructs ``LinuxSbAdapter(cfg.agg_api_base, cfg.ua, cfg.forums)`` without the
alerter it builds two lines later, so as wired the switch cannot alert. This
adapter therefore accepts an optional ``alerter=`` keyword and, when none is
attached, publishes the message on ``self.pending_alerts`` + ``self.warnings``
instead of dropping it. Suggested skeleton fix: build the alerter into a local
first, then pass ``alerter=alerter`` into the adapter. Related naming note: the
ask's ``degraded_enrich=true`` is carried by the contract field
``FullPost.enriched=False`` (ARCHITECTURE 3.1) because ``FullPost`` is read-only
and has no such field.

Everything the implementation does is traceable to 07 §四 ①/② and 02:

``discover()`` (P0-2, 07 §5.1)
    * Primary path: ``GET {api_base}?limit=100&forum={2,8,3}``. The ``User-Agent``
      header is mandatory or the aggregator answers 403 (02 §A.3); ``limit`` caps at
      100 and ``page`` is ignored (02 §A.3), so there is no paging.
    * Cursor: only posts with ``tid > since_tid`` are returned. The watermark value
      itself is owned by ``store.db.crawl_state`` and read/written by
      ``main.run_cycle`` - the adapter only consumes ``since_tid`` (07 §四 ①).
    * Dedupe: :func:`sources.base.dedupe_by_fingerprint` (first 40 chars, 07 §四 ①).
    * Fallback: if *every* configured forum request fails, switch to the first-party
      ``sitemap.xml`` (02 §A.2) and fire exactly one ``alerter.notify()``
      (07 §5.4 ⑥ / §四 "聚合源不可达"). A partial success (some forums answered)
      returns what it got without switching - the source is not unreachable.

``enrich()`` (P0-3, 07 §5.1)
    * ``GET https://linux.sb/topic/{tid}``, parse the ``application/ld+json`` block
      and walk ``@graph`` -> the :data:`interfaces.JSONLD_POSTING_TYPE` node ->
      ``articleBody`` (02 §A.1). That beats the aggregator's ~200-char truncation
      (07 §四 ②; 05 §四 measured 23684 -> 1037 chars).
    * Sniff ``reply_visible_locked`` (07 §四 ② ``nb-editor-reply-visible-locked``,
      02 §A.5 measured 4/4 vs 0 controls) and ``virtual_card``
      (:data:`interfaces.D_BADGE_MARKERS`, 02 §A.5).
    * Politeness: browser UA, 20 s timeout, >=0.5 s between requests to one host,
      3 attempts with a 1 s / 4 s backoff on 429/5xx/timeout (02 §B.6 line 171).
    * Degradation (07 §5.1 P0-3, §九 "解析失败即告警降级"): on any failure or a
      missing JSON-LD node, return ``enriched=False`` carrying the truncated
      ``content_text``. Never raise into the cycle. Note the contract spells the
      ask's ``degraded_enrich`` flag as ``FullPost.enriched == False`` - there is no
      ``degraded_enrich`` field in :mod:`interfaces`, and adding one is out of scope.
      ``main.run_cycle`` counts ``not full.enriched`` as ``enrich_degraded``.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Callable, List, Optional, Sequence, Tuple

from interfaces import (
    AGG_LIMIT_MAX,
    D_BADGE_MARKERS,
    FullPost,
    JSONLD_POSTING_TYPE,
    PROBE_SAME_HOST_MIN_INTERVAL_S,
    RawPost,
    REPLY_VISIBLE_LOCKED_MARKER,
    TRUNCATED_BODY_LEN,
)
from sources.base import SourceAdapter, dedupe_by_fingerprint

__all__ = ["LinuxSbAdapter", "extract_jsonld_documents", "find_article_body", "find_date_published"]

#: Forum ids pulled every cycle (07 §5.2 FORUMS=2,8,3; overridden by config).
DEFAULT_FORUMS: Tuple[int, ...] = (2, 8, 3)

#: Request timeout in seconds for aggregator + topic fetches (07 §四 ② / the ask).
REQUEST_TIMEOUT_S = 20.0

#: Minimum seconds between two requests to the *same* host (polite crawl).
#: 07 defines exactly one such number - "同主机间隔 >=0.5s" (§8.3, exported as
#: ``interfaces.PROBE_SAME_HOST_MIN_INTERVAL_S``) - so it is reused rather than
#: written again, per ARCHITECTURE §4 ("勿在实现里写死数字").
ENRICH_MIN_INTERVAL_S = PROBE_SAME_HOST_MIN_INTERVAL_S

#: Backoff schedule after a retryable failure; total attempts = 1 + len().
#: 02 §B.6 line 171: "5xx/000/超时 -> 1s,4s,10s，最多 3 次". Capped at 3 attempts
#: per post here because enrichment is a per-cycle normal step (~6-8 posts), not a
#: probe where burning budget is acceptable.
ENRICH_RETRY_BACKOFF_S: Tuple[float, ...] = (1.0, 4.0)

#: Topic page URL template used by enrichment (07 §四 ②).
TOPIC_URL_TEMPLATE = "https://linux.sb/topic/{tid}"

#: First-party sitemap used as the discovery fallback (02 §A.2 / 07 §四 ①).
SITEMAP_URL = "https://linux.sb/sitemap.xml"

#: ``<script type="application/ld+json">…</script>`` - attribute order tolerant.
_LDJSON_SCRIPT_RE = re.compile(
    r"<script\b[^>]*\btype\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.IGNORECASE | re.DOTALL,
)

#: A ``/topic/<digits>`` url (sitemap loc + aggregator url both use this shape).
_TOPIC_TID_RE = re.compile(r"/topic/(\d+)")


class AggregatorUnreachable(Exception):
    """Raised internally when a single aggregator request fails, so ``discover``
    can decide between a partial result and the sitemap fallback."""


def _default_transport(url: str, headers: dict, timeout: float) -> Tuple[int, str]:
    """Stdlib GET returning ``(status, body_text)``.

    ``HTTPError`` is *not* an exception here: a 403/429/5xx body is still
    meaningful to the caller, so its status and body are returned. A genuine
    transport failure (DNS, refused, timeout) propagates as ``URLError`` /
    ``OSError`` and is what :meth:`LinuxSbAdapter.discover` treats as unreachable.
    """
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            status = getattr(response, "status", None) or response.getcode()
            return int(status), response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            raw = exc.read()
        except Exception:  # body already consumed / socket closed
            raw = b""
        if raw:
            body = raw.decode("utf-8", "replace")
        return int(exc.code or 0), body


def extract_jsonld_documents(html: str) -> List[dict]:
    """Parse every ``application/ld+json`` block in ``html`` into dicts (07 §四 ②).

    A block may be a single object, an array, or an object with ``@graph``. Bad
    JSON is skipped (a topic page with one malformed block still yields the other
    blocks); the caller degrades when *no* document has a posting node.
    """
    documents: List[dict] = []
    for raw in _LDJSON_SCRIPT_RE.findall(html or ""):
        raw = raw.strip()
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            documents.append(parsed)
        elif isinstance(parsed, list):
            documents.extend(node for node in parsed if isinstance(node, dict))
    return documents


def _iter_nodes(document: dict):
    """Yield every node reachable through ``@graph`` / plain nested lists."""
    stack = [document]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            yield node
            graph = node.get("@graph")
            if isinstance(graph, dict):
                stack.append(graph)
            elif isinstance(graph, list):
                stack.extend(item for item in graph if isinstance(item, dict))
            for key in ("mainEntity", "item"):
                child = node.get(key)
                if isinstance(child, dict):
                    stack.append(child)
        elif isinstance(node, list):
            stack.extend(item for item in node if isinstance(item, dict))


def _node_types(node: dict) -> List[str]:
    node_type = node.get("@type")
    if isinstance(node_type, str):
        return [node_type]
    if isinstance(node_type, list):
        return [t for t in node_type if isinstance(t, str)]
    return []


def find_article_body(html: str) -> str:
    """Return the ``DiscussionForumPosting.articleBody`` from ``html`` or ``""``.

    07 §四 ② fixes the path: JSON-LD ``@graph`` -> the node whose ``@type`` is
    :data:`interfaces.JSONLD_POSTING_TYPE` -> ``articleBody``. Empty string means
    "not found", which is the caller's signal to degrade.
    """
    for document in extract_jsonld_documents(html):
        for node in _iter_nodes(document):
            if JSONLD_POSTING_TYPE in _node_types(node):
                body = node.get("articleBody")
                if isinstance(body, str) and body:
                    return body
    return ""


def find_date_published(html: str) -> str:
    """Return the ``DiscussionForumPosting.datePublished`` from ``html`` or ``""``.

    Same traversal as :func:`find_article_body`. The raw ISO string is
    normalised by :func:`_normalise_post_time` at the call site.
    """
    for document in extract_jsonld_documents(html):
        for node in _iter_nodes(document):
            if JSONLD_POSTING_TYPE in _node_types(node):
                value = node.get("datePublished")
                if isinstance(value, str) and value:
                    return value
    return ""


def _normalise_post_time(value: str) -> str:
    """ISO ``datePublished`` -> ``YYYY-MM-DD HH:MM`` in UTC+8 (site owner zone).

    Discourse emits UTC (``Z`` / ``+00:00``); naive values are treated as UTC.
    Unparsable input is returned verbatim so the raw string still surfaces.
    """
    from datetime import datetime, timedelta, timezone

    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")


def _html_marker_hit(html: str, marker: str) -> bool:
    """DOM marker test tolerant of the CSS-class dot in :data:`D_BADGE_MARKERS`.

    ``".virtual-card-box"`` is written with a leading dot in the contract, but
    HTML carries ``class="virtual-card-box"`` with no dot - both spellings are
    tried so the marker matches the live markup (02 §A.5) and the constant.
    """
    if not html or not marker:
        return False
    return marker in html or marker.lstrip(".") in html


class LinuxSbAdapter(SourceAdapter):
    """linux.sb discovery + enrichment implementing the frozen SourceAdapter ABC."""

    source_id = "linux_sb"

    def __init__(
        self,
        api_base: str,
        user_agent: str,
        forums: Sequence[int] = DEFAULT_FORUMS,
        *,
        transport: Optional[Callable[[str, dict, float], Tuple[int, str]]] = None,
        alerter=None,
        sleeper: Optional[Callable[[float], None]] = None,
        clock: Optional[Callable[[], float]] = None,
        timeout_s: float = REQUEST_TIMEOUT_S,
        min_interval_s: float = ENRICH_MIN_INTERVAL_S,
        retry_backoff_s: Sequence[float] = ENRICH_RETRY_BACKOFF_S,
    ):
        # Plain values, not the whole AppConfig: the adapter must be testable with
        # a fake transport and three strings (``main.build_components`` maps
        # cfg.agg_api_base / cfg.ua / cfg.forums onto these three positionals).
        self.api_base = api_base
        self.user_agent = user_agent
        self.forums = tuple(forums)
        self.transport = transport or _default_transport
        #: Injectable sink used for the mandatory sitemap-fallback alert
        #: (07 §5.4 ⑥). ``main.run_cycle`` alerts on ``result.warnings`` itself, so
        #: the adapter works with ``alerter=None`` too and still records the switch.
        self.alerter = alerter
        self.sleeper = sleeper or time.sleep
        self.clock = clock or time.monotonic
        self.timeout_s = float(timeout_s)
        self.min_interval_s = float(min_interval_s)
        self.retry_backoff_s = tuple(retry_backoff_s)
        self._last_request_at: dict = {}
        #: Every operational warning raised during this instance's lifetime, in
        #: order (``main`` may surface them; tests assert against them).
        self.warnings: List[str] = []
        #: Source-switch alerts that had nowhere to go because no ``alerter`` was
        #: attached (see the CONTRACT-ISSUE note in the module docstring). Tests and
        #: an integrator can drain this to prove 07 5.4 6 fired exactly once.
        self.pending_alerts: List[str] = []

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------
    def _headers(self, accept: str = "text/html,application/json;q=0.9,*/*;q=0.8") -> dict:
        # The UA is mandatory: the aggregator answers 403 without it (02 §A.3).
        return {"User-Agent": self.user_agent, "Accept": accept}

    def _throttle(self, url: str) -> None:
        """Sleep so consecutive requests to one host stay >= min_interval apart."""
        host = urllib.parse.urlsplit(url).netloc
        now = self.clock()
        last = self._last_request_at.get(host)
        if last is not None:
            wait = self.min_interval_s - (now - last)
            if wait > 0:
                self.sleeper(wait)
                now = last + self.min_interval_s
        self._last_request_at[host] = now

    def _request(self, url: str, accept: str) -> Tuple[int, str]:
        self._throttle(url)
        return self.transport(url, self._headers(accept), self.timeout_s)

    def _record(self, message: str) -> None:
        self.warnings.append(message)

    # ------------------------------------------------------------------
    # P0-2 discovery
    # ------------------------------------------------------------------
    def discover(self, since_tid: int) -> List[RawPost]:
        """Aggregator-first discovery with a sitemap fallback (07 §四 ①, P0-2).

        Returns the posts with ``tid > since_tid``, deduped by body fingerprint.
        Never raises for an unreachable aggregator - it switches to the sitemap and
        alerts once (07 §5.4 ⑥). Only programmer errors propagate.
        """
        since_tid = int(since_tid or 0)
        collected: List[RawPost] = []
        failures = 0
        errors: List[str] = []
        for forum in self.forums:
            try:
                collected.extend(self._discover_forum(forum, since_tid))
            except AggregatorUnreachable as exc:
                failures += 1
                errors.append(str(exc))

        if self.forums and failures == len(self.forums):
            # Every forum failed: the aggregator is unreachable -> first-party
            # sitemap fallback + exactly one alert (07 §四 ① / §5.4 ⑥).
            reason = "; ".join(errors[:3]) or "no response"
            message = (
                f"[warning] linux_sb aggregator unreachable ({reason}); "
                f"fell back to {SITEMAP_URL}"
            )
            self._record(message)
            self._notify(message)
            return dedupe_by_fingerprint(self.discover_via_sitemap(since_tid))

        if errors:
            # Partial failure is worth a warning but not a source switch.
            self._record(
                "[warning] linux_sb aggregator partially unreachable "
                f"({failures}/{len(self.forums)} forums: {'; '.join(errors[:3])})"
            )
        return dedupe_by_fingerprint(collected)

    def _discover_forum(self, forum: int, since_tid: int) -> List[RawPost]:
        query = urllib.parse.urlencode({"limit": AGG_LIMIT_MAX, "forum": forum})
        url = f"{self.api_base}?{query}"
        try:
            status, body = self._request(url, "application/json")
        except NotImplementedError:
            raise
        except Exception as exc:
            # Anything a transport can raise (URLError, socket.timeout, a codec
            # error, an SSL failure) means "this forum page did not answer", which
            # is a source problem, not a cycle problem. main.py:172 calls discover
            # with no try/except, so this must never propagate.
            raise AggregatorUnreachable(
                f"forum={forum} transport error: {type(exc).__name__}"
            )
        if status == 403:
            raise AggregatorUnreachable("forum=%d 403 (UA rejected?)" % forum)
        if status != 200:
            raise AggregatorUnreachable(f"forum={forum} HTTP {status}")
        try:
            payload = json.loads(body)
        except (ValueError, TypeError):
            raise AggregatorUnreachable(f"forum={forum} non-JSON body")
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise AggregatorUnreachable(f"forum={forum} payload has no data[]")
        posts: List[RawPost] = []
        for row in data:
            if not isinstance(row, dict):
                continue
            post = self._row_to_raw_post(row)
            if post is not None and post.tid > since_tid:
                posts.append(post)
        return posts

    def _row_to_raw_post(self, row: dict) -> Optional[RawPost]:
        """Direct field mapping (names match 02 §A.3, so it is near-verbatim)."""
        tid = _as_int(row.get("tid"))
        if tid is None:
            return None
        return RawPost(
            tid=tid,
            title=str(row.get("title") or ""),
            forum_id=_as_int(row.get("forum_id")) or 0,
            forum_name=str(row.get("forum_name") or ""),
            author_name=str(row.get("author_name") or ""),
            url=str(row.get("url") or TOPIC_URL_TEMPLATE.format(tid=tid)),
            content_text=str(row.get("content_text") or ""),
            post_time=str(row.get("post_time") or ""),
            views_count=_as_int(row.get("views_count")) or 0,
            replies_count=_as_int(row.get("replies_count")) or 0,
            likes_count=_as_int(row.get("likes_count")) or 0,
            source_id=self.source_id,
        )

    def discover_via_sitemap(self, since_tid: int) -> List[RawPost]:
        """``sitemap.xml`` loc/tid fallback (07 §四 ①, P0-2, 02 §A.2).

        Rows carry ``content_text=""`` because the sitemap only exposes ``loc`` +
        ``lastmod`` - they must be enriched to be classifiable (``post_time`` holds
        ``lastmod`` so an operator can still see recency). Sorted ascending by tid
        so the newest sit at the end, matching the aggregator's cursor convention.

        Ceiling: only the newest :data:`interfaces.AGG_LIMIT_MAX`` (100) tids are
        returned. 02 §A.2 measured 13,443 topic URLs in the sitemap, so an empty
        watermark would otherwise hand ``run_cycle`` thousands of enrichment
        requests and break 07 §5.4 ① ("单轮 <5 分钟"). 100 is not a 07 number for
        *this* path - it reuses the aggregator's page ceiling so both discovery
        paths have the same per-cycle cost.
        """
        since_tid = int(since_tid or 0)
        try:
            status, body = self._request(SITEMAP_URL, "application/xml,text/xml,*/*")
        except NotImplementedError:
            raise
        except Exception as exc:
            self._record(f"[warning] linux_sb sitemap unreachable: {type(exc).__name__}")
            return []
        if status != 200 or not body:
            self._record(f"[warning] linux_sb sitemap HTTP {status}")
            return []
        posts = []
        for loc, lastmod in _iter_sitemap_urls(body):
            match = _TOPIC_TID_RE.search(urllib.parse.urlsplit(loc).path)
            if not match:
                continue
            tid = int(match.group(1))
            if tid <= since_tid:
                continue
            posts.append(
                RawPost(
                    tid=tid,
                    title="",
                    forum_id=0,
                    forum_name="",
                    author_name="",
                    url=loc,
                    content_text="",
                    post_time=lastmod,
                    source_id=self.source_id,
                )
            )
        posts.sort(key=lambda post: post.tid)
        if len(posts) > AGG_LIMIT_MAX:
            posts = posts[-AGG_LIMIT_MAX:]
        return posts

    # ------------------------------------------------------------------
    # P0-3 enrichment
    # ------------------------------------------------------------------
    def enrich(self, post: RawPost) -> FullPost:
        """JSON-LD ``articleBody`` enrichment + C/D marker sniffing (07 §四 ②, P0-3).

        Polite (UA / 20 s timeout / >=0.5 s per host / 1 s + 4 s backoff, 3
        attempts). On any failure or a missing posting node it degrades to
        ``enriched=False`` with the truncated text and never raises (07 §5.1 P0-3).
        """
        url = TOPIC_URL_TEMPLATE.format(tid=post.tid)
        html = ""
        attempts = 1 + len(self.retry_backoff_s)
        for attempt in range(attempts):
            if attempt:
                self.sleeper(self.retry_backoff_s[attempt - 1])
            try:
                status, html = self._request(url, "text/html,application/xhtml+xml,*/*")
            except NotImplementedError:
                raise
            except Exception as exc:
                # Anything a transport can raise (URLError, OSError, timeout, a
                # decoder error) is a fetch failure, not a cycle failure: the
                # contract says enrichment never raises (interfaces.SourceAdapter).
                status = 0
                html = ""
                self._record(
                    f"enrich tid={post.tid} attempt {attempt + 1} transport "
                    f"error: {type(exc).__name__}"
                )
            if status == 200:
                break
            # 404/410 are permanent (the post is gone): stop retrying.
            if status in (404, 410):
                break
            self._record(f"enrich tid={post.tid} attempt {attempt + 1} HTTP {status}")
        if status == 200 and html:
            return self._build_full_post(post, html)
        self._record(f"enrich tid={post.tid} degraded: no usable response (HTTP {status})")
        return self._degraded(post)

    def _build_full_post(self, post: RawPost, html: str) -> FullPost:
        article_body = find_article_body(html)
        reply_visible_locked = REPLY_VISIBLE_LOCKED_MARKER in html
        virtual_card = any(_html_marker_hit(html, marker) for marker in D_BADGE_MARKERS)
        # Original forum posting time (site page shows "原帖 …"; 2026-10-08):
        # JSON-LD datePublished is authoritative, so it overwrites whatever the
        # list/sitemap fallback left in post_time (lastmod is a *modified* date).
        date_published = find_date_published(html)
        if date_published:
            post.post_time = _normalise_post_time(date_published)
        # 07 §8.1 D row records 标题+链接+价格; the price box (.virtual-card-price)
        # lives in the fetched topic HTML (02 §A.5), NOT in the JSON-LD
        # articleBody (rules_linux_sb's own note: "must sniff the fetched page
        # HTML, not the JSON-LD articleBody"), so enrichment is the only place
        # the pipeline can capture it. Additive FullPost.virtual_card_price.
        virtual_card_price = ""
        if virtual_card:
            from classify.rules_linux_sb import card_price  # lazy, D10 layering

            virtual_card_price = card_price(html) or ""
        if not article_body:
            # 200 but no DiscussionForumPosting body (structural change or a
            # non-topic page): degrade to the truncated text (07 §九), but keep
            # the DOM sniff - a gated post still has its marker to classify C.
            self._record(f"enrich tid={post.tid}: no articleBody in JSON-LD")
            return FullPost(
                raw=post,
                article_body="",
                reply_visible_locked=reply_visible_locked,
                virtual_card=virtual_card,
                virtual_card_price=virtual_card_price,
                enriched=False,
            )
        return FullPost(
            raw=post,
            article_body=article_body,
            reply_visible_locked=reply_visible_locked,
            virtual_card=virtual_card,
            virtual_card_price=virtual_card_price,
            enriched=True,
        )

    def _degraded(self, post: RawPost) -> FullPost:
        """Enrichment failed: return the truncated aggregator body (07 §四 ② / P0-3)."""
        return FullPost(
            raw=post,
            article_body=(post.content_text or "")[:TRUNCATED_BODY_LEN],
            enriched=False,
        )

    def _notify(self, message: str) -> None:
        """Best-effort alert on the source-switch path (07 5.4 6).

        With an ``alerter`` attached this is the required DingTalk push. Without
        one (the way ``main.build_components`` currently constructs the adapter -
        see the module docstring's CONTRACT-ISSUE) the message is queued on
        ``self.pending_alerts`` so the switch is still provable and drainable, and
        ``main.run_cycle`` also sees it through ``self.warnings``.
        """
        alerter = self.alerter
        if alerter is None:
            self.pending_alerts.append(message)
            return
        try:
            alerter.notify(message)
        except Exception as exc:  # alerting must never break a crawl cycle
            self._record(f"sitemap-fallback alert failed: {type(exc).__name__}")

    # ------------------------------------------------------------------
    # D10 source-specific rules
    # ------------------------------------------------------------------
    def classify_rules(self):
        """The C / D rules that are linux.sb only (D10 hook, 07 §8.1 规则分层)."""
        from classify.rules_linux_sb import linux_sb_rules

        return linux_sb_rules()


def _as_int(value) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _iter_sitemap_urls(xml_text: str):
    """Yield ``(loc, lastmod)`` for every ``<url>`` entry, namespace-tolerantly.

    Parsed with :mod:`xml.etree.ElementTree` (stdlib) against the sitemap 0.9
    namespace; if the document is malformed the regex fallback recovers ``loc``
    entries so a slightly broken sitemap still yields candidate tids (02 §A.2).
    """
    try:
        import xml.etree.ElementTree as ET

        root = ET.fromstring(xml_text)
    except Exception:
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml_text):
            yield loc, ""
        return
    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag != "url":
            continue
        loc = ""
        lastmod = ""
        for child in element:
            child_tag = child.tag.rsplit("}", 1)[-1]
            if child_tag == "loc":
                loc = (child.text or "").strip()
            elif child_tag == "lastmod":
                lastmod = (child.text or "").strip()
        if loc:
            yield loc, lastmod
