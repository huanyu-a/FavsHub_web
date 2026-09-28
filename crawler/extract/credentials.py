"""Layered credential extraction + (key, base_url) pairing (07 §8.2, P0-5).

CONTRACT-ISSUE: ``fixtures/linux_sb_jsonld_graph.json`` annotates
``expected.credential_line.confidence = "high"`` for a body where the URL and the
key are on ADJACENT lines. 07 §8.2 reserves ``high`` for a key + URL sharing the
same LINE / code block / JSON object / table row *within the shared text*; once
enrichment has handed us ``articleBody`` the enclosing JSON-LD wrapper is gone, so
adjacent lines are ``medium`` (行距 <= 3). This module follows 07 verbatim and
emits ``medium``; if the skeleton intends the meta-JSON-object to count as ``high``,
that needs a pairing rule over the raw JSON-LD node, not the extracted body.

Owner: extract. Contract entry point: :class:`LayeredExtractor`.

Every pattern, threshold and confidence constant is imported from
:mod:`interfaces` - transcribed verbatim from 07 §8.2 there. This module never
re-types a regex (one divergent character silently breaks the measured hit counts
of 07 §8.1 and the P0-5 acceptance replay).

Pipeline for one B-class body (07 §四 ④, §5.1 P0-5):

  1. strip the ``Bearer`` prefix before matching (07 §8.2 first line) - newline
     safe, so the line geometry the pairing table depends on never moves;
  2. run the three layered patterns (primary / generic / Google-specific), union,
     de-duplicate, preserve order. An ``sk-`` tail is NEVER re-split on ``-``
     (07 §8.2: New API truncates on the first dash server-side - its bug, not ours);
  3. pair every key with a base_url per the 07 §8.2 confidence table (same line /
     code block / JSON object = high; line distance <= 3, or the sole 1-URL +
     1-key, or a lone 1-URL + 1-key paragraph = medium; one-to-many = low);
  4. the prefix heuristic guesses the provider only, never the base_url
     (07 §8.2 "猜来源不替代 URL", §B.5 "中转站凭证无法反推 base_url");
  5. low-confidence keys expanded into several candidate endpoints are resolved by
     single-shot ``GET /v1/models`` probes (07 §8.2 last row; zero cost, capped at
     :data:`interfaces.PAIR_DISAMBIG_MAX_CANDIDATES`).

Security (07 §8.5): the plaintext key lives only in the returned
:class:`CredentialPair.key` field, which ``__repr__`` masks; the ``evidence`` audit
string never contains the key, and the masking / hashing / encryption triad is
produced by :mod:`crypto` (:func:`crypto_triplet`). No authenticated fetch, no gate bypass, no
network of its own - a gated block with no plaintext simply yields no credential
(07 §5.3 / D2). The only time a credential from behind a ``[回复可见]`` marker is
emitted is when the aggregator already handed the raw text to us (02 §D.6, tid
23295); that is provenance we read and label ``aggregator_leak``, not a gate we
worked around.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from interfaces import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_MEDIUM,
    CredentialExtractor,
    CredentialPair,
    GENERIC_CREDENTIAL_RE,
    GOOGLE_CREDENTIAL_RE,
    KEY_SOURCE_AGGREGATOR_LEAK,
    KEY_SOURCE_POST,
    PAIR_DISAMBIG_MAX_CANDIDATES,
    PAIR_MEDIUM_MAX_LINE_GAP,
    PREFIX_BASE_URL_HINTS,
    PRIMARY_CREDENTIAL_RE,
    Prober,
)

#: The three 07 §8.2 patterns, compiled once from the shared source strings.
PRIMARY_RE = re.compile(PRIMARY_CREDENTIAL_RE)
GENERIC_RE = re.compile(GENERIC_CREDENTIAL_RE)
GOOGLE_RE = re.compile(GOOGLE_CREDENTIAL_RE)

#: 07 §8.2: "提取前剔除 Bearer 前缀". Horizontal whitespace only: ``\s+`` would
#: swallow the newline that separates a header line from the key and corrupt the
#: line geometry the pairing table depends on.
BEARER_RE = re.compile(r"(?i)\bbearer[ \t]+")

#: Any http(s) URL in the body; the pairing step consumes these.
URL_RE = re.compile(r"https?://[^\s\"'<>()\[\]{}]+")

#: Trailing sentence punctuation that URL_RE greedily absorbs.
_URL_TRAILING = ")]},.;:!>\"'`"

#: 07 §8.1 / 02 §A.5 reply-gate placeholder pair. 02 §D.6: the aggregate API
#: returns the *raw* post text, so a `[回复可见]...[/回复可见]` block can carry
#: the credential in clear - a leak we read, never a gate we bypass.
_GATE_RE = re.compile(re.escape("[回复可见]") + r".*?" + re.escape("[/回复可见]"), re.DOTALL)


# ---------------------------------------------------------------------------
# Layer 1: text normalisation
# ---------------------------------------------------------------------------


def strip_bearer(text: str) -> str:
    """Remove ``Bearer`` prefixes before matching (07 §8.2 first line)."""
    if not text:
        return ""
    return BEARER_RE.sub("", text)


# ---------------------------------------------------------------------------
# Layer 2: the three layered patterns
# ---------------------------------------------------------------------------


def find_credentials(text: str) -> List[str]:
    """Union of primary / generic / Google-specific hits, de-duplicated, ordered.

    Tokens are returned in the order they *occur in the text*, not in pattern-layer
    order: a credential recognised by the primary layer must not jump ahead of an
    earlier one that only the generic layer catches. Overlapping hits (the same key
    matched by two layers) collapse to one entry at their earliest position.

    Do NOT split an ``sk-`` token further on ``-`` (07 §8.2): New API truncates
    the tail on the first dash server-side, which is its bug, not ours.
    """
    if not text:
        return []
    # (first_start, token) over every layer, so the union is position-ordered.
    first: Dict[str, int] = {}
    for rx in (PRIMARY_RE, GENERIC_RE, GOOGLE_RE):
        for match in rx.finditer(text):
            token = match.group()
            start = match.start()
            if token not in first or start < first[token]:
                first[token] = start
    return [tok for tok, _ in sorted(first.items(), key=lambda kv: kv[1])]


def _clean_url(raw: str) -> str:
    return raw.rstrip(_URL_TRAILING)


def find_urls(text: str) -> List[str]:
    """De-duplicated http(s) URLs, order preserved, trailing punctuation trimmed."""
    if not text:
        return []
    out: List[str] = []
    seen: set = set()
    for match in URL_RE.finditer(text):
        url = _clean_url(match.group())
        if url and url not in seen:
            seen.add(url)
            out.append(url)
    return out


# ---------------------------------------------------------------------------
# Layer 4 (used during pairing): prefix heuristic - provider guess only
# ---------------------------------------------------------------------------


def provider_for_key(key: str) -> str:
    """Prefix -> provider guess (07 §8.2 "猜来源不替代 URL").

    Never invents a base_url: an anonymous relay key carries no origin (§B.5).
    """
    for prefix, host in PREFIX_BASE_URL_HINTS:
        if key.startswith(prefix):
            return host
    return ""


# ---------------------------------------------------------------------------
# Structural geometry the confidence table consumes
# ---------------------------------------------------------------------------


class _Layout:
    """Line-indexed paragraph / code-block / JSON-object / table-row positions.

    A deliberately conservative reading of the 07 §8.2 "same code block / same
    JSON object / same line / same table row" wording: fenced ``` blocks, brace
    objects, blank-line paragraphs and ``|``-prefixed Markdown rows. Anything the
    forum body does not clearly delimit falls back to line distance, which the
    confidence table treats as medium at best.
    """

    __slots__ = ("lines", "para", "code", "json", "table", "_at")

    def __init__(self, text: str) -> None:
        self.lines = text.split("\n")
        self.para: List[int] = []
        self.code: List[Optional[int]] = []
        self.json: List[Optional[int]] = []
        self.table: List[bool] = []
        self._at: Dict[str, int] = {}
        self._scan()

    def _scan(self) -> None:
        para = 0
        code_id: Optional[int] = None
        code_open = False
        stack: List[int] = []
        nxt_json = 0
        for line in self.lines:
            stripped = line.strip()
            if not stripped:
                self.para.append(para)
                self.code.append(code_id if code_open else None)
                self.json.append(stack[-1] if stack else None)
                self.table.append(False)
                para += 1  # the next non-blank line opens a new paragraph
                continue

            self.para.append(para)

            if stripped.startswith("```"):
                code_open = not code_open
                if code_open:
                    code_id = 0 if code_id is None else code_id + 1
                self.code.append(code_id)
                self.json.append(stack[-1] if stack else None)
                self.table.append(False)
                continue

            self.code.append(code_id if code_open else None)

            opened: Optional[int] = None
            for ch in line:
                if ch == "{":
                    if opened is None:
                        opened = nxt_json
                    stack.append(nxt_json)
                    nxt_json += 1
                elif ch == "}" and stack:
                    stack.pop()
            if opened is not None and not stack:
                self.json.append(opened)  # a complete one-line object
            else:
                self.json.append(stack[-1] if stack else None)

            self.table.append(stripped.startswith("|"))

    def line_of(self, token: str) -> int:
        """Index of the first line containing ``token`` (0 if the token is absent)."""
        cached = self._at.get(token)
        if cached is not None:
            return cached
        idx = 0
        for i, ln in enumerate(self.lines):
            if token in ln:
                idx = i
                break
        self._at[token] = idx
        return idx

    def unit(self, token: str) -> Tuple[int, Optional[int], Optional[int], int, bool]:
        """(line, code_id, json_id, para_id, is_table_row) for a token."""
        line = self.line_of(token)
        return line, self.code[line], self.json[line], self.para[line], self.table[line]


def _lone_in(layout: _Layout, kind: str, key: str, keys: Sequence[str],
            urls: Sequence[str]) -> Optional[str]:
    """The unique url sharing ``key``'s code/JSON block, when it holds 1 key + 1 url.

    07 §8.2 high requires "同代码块 / 同 JSON 对象 ... 内 1 URL + 1 key": a block
    with a second key (or a second url) is genuinely ambiguous, so no high there.
    """
    pos = 1 if kind == "code" else 2
    block = layout.unit(key)[pos]
    if block is None:
        return None
    keys_in = [k for k in keys if layout.unit(k)[pos] == block]
    urls_in = [u for u in urls if layout.unit(u)[pos] == block]
    if len(keys_in) == 1 and len(urls_in) == 1:
        return urls_in[0]
    return None


def _lone_in_paragraph(layout: _Layout, key: str, keys: Sequence[str],
                       urls: Sequence[str]) -> Optional[str]:
    """The unique url sharing ``key``'s paragraph, when the paragraph holds 1+1."""
    para = layout.unit(key)[3]
    keys_in = [k for k in keys if layout.unit(k)[3] == para]
    urls_in = [u for u in urls if layout.unit(u)[3] == para]
    if len(keys_in) == 1 and len(urls_in) == 1:
        return urls_in[0]
    return None


# ---------------------------------------------------------------------------
# Layer 3: the (key, base_url) pairing confidence table (07 §8.2)
# ---------------------------------------------------------------------------


def _make_pair(key: str, base_url: str, confidence: str, evidence: str) -> CredentialPair:
    return CredentialPair(
        key=key,
        base_url=base_url,
        provider=provider_for_key(key),
        confidence=confidence,
        origin=KEY_SOURCE_POST,
        evidence=evidence,
    )


def pair(keys: Sequence[str], urls: Sequence[str], text: str) -> List[CredentialPair]:
    """Assign a confidence level to each ``(key, base_url)`` candidate.

    07 §8.2 table, in tier order (first tier that matches decides the level):
      * high   - same line / table row, or same code block, or same JSON object,
        each holding exactly one key + one url;
      * low    - one-to-many: 1 URL + N keys, or 1 key + N URLs. The 1-key/N-URL
        case is expanded into its N candidate pairs (base_url filled, low) so
        :func:`disambiguate` can probe them;
      * medium - the sole 1-URL + 1-key document, a lone 1-URL + 1-key paragraph,
        or the nearest URL within :data:`PAIR_MEDIUM_MAX_LINE_GAP` lines;
      * else   - nearest URL, low (too far / not close enough to trust).

    A key with no URL at all is dropped by the caller (:meth:`LayeredExtractor
    .extract`): 07 §8.2 forbids reverse-engineering a relay endpoint.
    """
    if not keys or not urls:
        return []
    layout = _Layout(text or "")
    total_keys, total_urls = len(keys), len(urls)

    out: List[CredentialPair] = []
    for key in keys:
        line = layout.line_of(key)

        # tier 1 - same line / Markdown table row (exactly one url on the line).
        same_line = [u for u in urls if layout.line_of(u) == line]
        if len(same_line) == 1:
            evidence = "same table row" if layout.table[line] else "same line"
            out.append(_make_pair(key, same_line[0], CONFIDENCE_HIGH, evidence))
            continue

        # tier 2 - same code block, then same JSON object (each 1 key + 1 url).
        hit = _lone_in(layout, "code", key, keys, urls)
        if hit:
            out.append(_make_pair(key, hit, CONFIDENCE_HIGH, "same code block"))
            continue
        hit = _lone_in(layout, "json", key, keys, urls)
        if hit:
            out.append(_make_pair(key, hit, CONFIDENCE_HIGH, "same JSON object"))
            continue

        # tier 3 - one-to-many (07 §8.2 low row): one side is a lone member and
        # the other carries several, so the pairing is genuinely ambiguous. A
        # document with exactly one key AND one url is not one-to-many; it falls
        # through to the medium tiers below.
        if total_urls == 1 and total_keys > 1:
            out.append(_make_pair(key, urls[0], CONFIDENCE_LOW,
                                  f"one URL, {total_keys} keys"))
            continue
        if total_keys == 1 and total_urls > 1:
            out.extend(
                _make_pair(key, url, CONFIDENCE_LOW,
                           f"one key, {total_urls} URL candidates {i + 1}/{total_urls}")
                for i, url in enumerate(urls)
            )
            continue

        # tier 4 - the sole key+url document, then a lone 1+1 paragraph.
        if total_keys == 1 and total_urls == 1:
            out.append(_make_pair(key, urls[0], CONFIDENCE_MEDIUM, "sole key+url document"))
            continue
        para_hit = _lone_in_paragraph(layout, key, keys, urls)
        if para_hit:
            out.append(_make_pair(key, para_hit, CONFIDENCE_MEDIUM, "same paragraph 1+1"))
            continue

        # tier 5 - nearest URL by line distance (medium within 3 lines, else low).
        nearest = min(urls, key=lambda u: abs(layout.line_of(u) - line))
        gap = abs(layout.line_of(nearest) - line)
        if gap <= PAIR_MEDIUM_MAX_LINE_GAP:
            out.append(_make_pair(key, nearest, CONFIDENCE_MEDIUM, f"line distance {gap}"))
        else:
            out.append(_make_pair(key, nearest, CONFIDENCE_LOW, f"line distance {gap}"))
    return out


def _gate_origins(text: str, keys: Sequence[str]) -> Dict[str, str]:
    """Map keys that sit inside an aggregator-leaked reply-gate block.

    02 §D.6: tid 23295's credential is present in the raw API text because the
    "[回复可见]" gate is enforced only at render time. We label such a pair
    ``aggregator_leak`` (07 §8.4 ``source``); no authenticated fetch is involved.
    """
    body = text or ""
    spans = [m.span() for m in _GATE_RE.finditer(body)]
    origins: Dict[str, str] = {}
    for key in keys:
        idx = body.find(key)
        if idx >= 0 and any(start <= idx < stop for start, stop in spans):
            origins[key] = KEY_SOURCE_AGGREGATOR_LEAK
    return origins


# ---------------------------------------------------------------------------
# Layer 5: probe disambiguation (07 §8.2 last row)
# ---------------------------------------------------------------------------


def disambiguate(pairs: Sequence[CredentialPair], prober: Prober) -> List[CredentialPair]:
    """Resolve low-confidence keys that were expanded into several candidates.

    07 §8.2: "候选组合各发一次 ``GET /v1/models``，取第一个非 401 的配对（零成本）".
    Each candidate is probed once; the first response that is neither a 401 (that
    endpoint rejects this key) nor a transport/5xx failure (inconclusive, 07 §8.3
    "绝不判失效") wins and is promoted to ``medium`` (the pairing is now evidenced);
    losers are dropped. A key whose candidates all fail to confirm keeps its first
    candidate as ``low`` so a human still reviews it. Total single-shot requests
    are capped at :data:`interfaces.PAIR_DISAMBIG_MAX_CANDIDATES`.
    """
    if prober is None:
        return _collapse_candidates(list(pairs))

    resolved: List[CredentialPair] = []
    groups: Dict[str, List[CredentialPair]] = {}
    order: List[str] = []
    for p in pairs:
        if p.confidence == CONFIDENCE_LOW:
            if p.key not in groups:
                groups[p.key] = []
                order.append(p.key)
            groups[p.key].append(p)
        else:
            resolved.append(p)

    budget = PAIR_DISAMBIG_MAX_CANDIDATES
    for key in order:
        candidates = groups[key]
        if len(candidates) == 1:
            resolved.append(candidates[0])
            continue
        winner: Optional[CredentialPair] = None
        for cand in candidates:
            if budget <= 0:
                break
            budget -= 1
            status = _probe_status(prober, cand)
            if _disambiguation_confirms(status):
                cand.confidence = CONFIDENCE_MEDIUM
                cand.evidence = f"{cand.evidence} probe-ok http={status}"
                winner = cand
                break
        resolved.append(winner if winner is not None else candidates[0])
    return resolved


def _disambiguation_confirms(status: Optional[int]) -> bool:
    """A candidate is the right endpoint when it answers non-401.

    07 §8.2 disambiguation is literally "取第一个非 401". A 401 means the endpoint
    rejected this key - the wrong pairing. A transport failure (``000``) or a 5xx
    proves nothing about which endpoint the key belongs to (07 §8.3: those are
    always inconclusive), so they neither confirm nor disqualify; the caller moves
    to the next candidate.
    """
    return status is not None and 100 <= status < 500 and status != 401


def _probe_status(prober: Prober, cand: CredentialPair) -> Optional[int]:
    """One disambiguation request; returns the HTTP status or ``None`` if unclear."""
    try:
        outcome = prober.probe(cand)
    except NotImplementedError:
        raise
    except Exception:
        return None
    status = getattr(outcome, "http_status", None)
    return int(status) if isinstance(status, int) else None


def _collapse_candidates(pairs: Sequence[CredentialPair]) -> List[CredentialPair]:
    """No prober: keep one representative pair per low-confidence key (manual queue)."""
    out: List[CredentialPair] = []
    seen: set = set()
    for p in pairs:
        if p.confidence == CONFIDENCE_LOW:
            if p.key in seen:
                continue
            seen.add(p.key)
        out.append(p)
    return out


# ---------------------------------------------------------------------------
# Crypto triad (07 §8.4 / §8.5): masked / hashed / encrypted
# ---------------------------------------------------------------------------


def crypto_triplet(pair: CredentialPair, fernet_key: Any = None) -> Dict[str, str]:
    """Produce the ``masked`` / ``hash`` / ``encrypted`` triad for persistence.

    Routing is mandatory: the masked form and the dedupe hash come from
    :mod:`crypto` (:class:`CredentialPair` already delegates), and the ciphertext
    is the only lawful home of the plaintext (07 §8.5). With no Fernet key
    ``encrypted`` is empty and the caller must skip the row upstream - it must
    never fall back to storing plaintext.
    """
    from crypto import encrypt_secret

    encrypted = encrypt_secret(pair.key, fernet_key) if fernet_key else ""
    return {"masked": pair.mask(), "hash": pair.hash(), "encrypted": encrypted}


# ---------------------------------------------------------------------------
# Contract stage
# ---------------------------------------------------------------------------


class LayeredExtractor(CredentialExtractor):
    """Extractor stage: strip Bearer -> layered regex -> pair -> (disambiguate)."""

    def __init__(self, cfg: Any = None, prober: Optional[Prober] = None):
        self.cfg = cfg
        #: ``None`` in the default pipeline; when injected it resolves low pairs.
        self.prober = prober

    def extract(self, post: Any) -> List[CredentialPair]:
        """Return every ``(key, base_url)`` pair for a B-class body.

        A B-class post that yields nothing is a recall limit of the patterns or
        the 200-char truncation (02 §D.9) - reported as a cycle warning upstream,
        never silently fabricated into a pair.
        """
        text = getattr(post, "text", "") or ""
        cleaned = strip_bearer(text)
        keys = find_credentials(cleaned)
        if not keys:
            return []
        urls = find_urls(cleaned)
        if not urls:
            # 07 §8.2: 中转站凭证无法反推 base_url - a lone key is NOT a pair.
            return []
        pairs = pair(keys, urls, cleaned)
        origins = _gate_origins(cleaned, keys)
        source_id = getattr(post, "source_id", "")
        source_tid = getattr(post, "tid", 0)
        for p in pairs:
            p.origin = origins.get(p.key, KEY_SOURCE_POST)
            p.source_id = source_id
            p.source_tid = source_tid
        if self.prober is None:
            return _collapse_candidates(pairs)
        return disambiguate(pairs, self.prober)
