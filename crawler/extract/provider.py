"""Provider normalisation for the public key cards (2026-10-09).

Why this module exists
----------------------
``provider`` used to be filled *only* by the key-prefix heuristic
(:func:`extract.credentials.provider_for_key`, 07 §8.2 "猜来源不替代 URL"):

    sk-or-… -> openrouter.ai, sk-ant… -> api.anthropic.com, AIza… -> google, …

A ``sk-`` relay key matches no prefix, so ``provider`` stayed empty for every
relay row - which is *all* of them in the live data. The card header then fell
back to the post title, so 11 different relays all rendered as 「免费token」.
The provider filter in the UI (``provider LIKE ?``) was dead weight for the
same reason.

Scope of the guess (deliberately narrow)
----------------------------------------
This module answers exactly one question: *what should this row be called on a
card?* It reads the **host of ``base_url``** - a value the extractor already
paired with the key and that the site already displays - and never invents a
base_url itself (07 §8.2 / §B.5: a relay credential carries no recoverable
origin endpoint). No network access, no key material, pure function.

Two outcomes:

* a host listed in :data:`PROVIDER_BRANDS` maps to a curated display brand
  (``api.deepseek.com`` -> ``DeepSeek``);
* anything else keeps its registrable-ish host as the brand
  (``https://xlai.pro`` -> ``xlai.pro``). That is honest and useful for relay
  stations: users recognise the relay they got a key from, and the host is
  already public on the card via ``base_url``.

Callers must treat a non-empty result as a *display label*, never as a
verified identity: the prefix heuristic still wins when it has an answer,
because a key prefix is direct evidence and a host is only contextual.
"""
from __future__ import annotations

from typing import Optional

#: Curated host -> display brand. Only well-known first-party API hosts belong
#: here; a relay station must keep its own domain (mislabelling a relay as the
#: official vendor would be a factual error on the card). Keys are compared
#: after lower-casing and stripping a leading ``www.``.
PROVIDER_BRANDS = {
    "api.openai.com": "OpenAI",
    "openai.com": "OpenAI",
    "api.anthropic.com": "Anthropic",
    "anthropic.com": "Anthropic",
    "openrouter.ai": "OpenRouter",
    "api.deepseek.com": "DeepSeek",
    "deepseek.com": "DeepSeek",
    "api.x.ai": "xAI",
    "x.ai": "xAI",
    "generativelanguage.googleapis.com": "Google Gemini",
    "aiplatform.googleapis.com": "Google Vertex",
    "api.groq.com": "Groq",
    "api.mistral.ai": "Mistral",
    "api.moonshot.cn": "Moonshot",
    "api.siliconflow.cn": "SiliconFlow",
    "open.bigmodel.cn": "Zhipu GLM",
    "api.z.ai": "Zhipu GLM",
    "dashscope.aliyuncs.com": "Alibaba DashScope",
    "api.cerebras.ai": "Cerebras",
    "api.fireworks.ai": "Fireworks",
    "api.together.xyz": "Together",
    "api.perplexity.ai": "Perplexity",
    "api.cohere.ai": "Cohere",
    "api.novita.ai": "Novita",
    "api.aihubmix.com": "AiHubMix",
    "api.gpt.ge": "GPT.ge",
    "api.chatfire.cn": "ChatFire",
}

#: Substrings that mark a host as a local/private endpoint rather than a brand.
#: Such a row must not be labelled with a host that means nothing to a reader.
_PRIVATE_MARKERS = ("localhost", "127.0.0.1", "0.0.0.0", "::1", "192.168.", "10.")


def _host(base_url: str) -> str:
    """Host portion of an http(s) URL without userinfo / port / path.

    Stdlib-free on purpose (no ``urllib.parse`` import cost in the hot path) and
    tolerant of the full-width characters forum posts interleave with URLs.
    """
    raw = (base_url or "").strip()
    if not raw:
        return ""
    lowered = raw.lower()
    for scheme in ("http://", "https://"):
        if lowered.startswith(scheme):
            raw = raw[len(scheme):]
            break
    else:
        # Not a URL at all - a bare host is acceptable, a prose fragment is not.
        if "/" in raw and not raw.startswith("//"):
            return ""
    raw = raw.split("//", 1)[-1]        # tolerate a scheme-relative "//host"
    for cut in ("/", "?", "#"):
        raw = raw.split(cut, 1)[0]
    if "@" in raw:                       # strip userinfo
        raw = raw.rsplit("@", 1)[-1]
    if raw.startswith("["):             # IPv6 literal: [::1]:8080
        raw = raw.split("]", 1)[0] + "]"
    elif ":" in raw:
        raw = raw.split(":", 1)[0]
    return raw.strip().strip(".")


def provider_for_base_url(base_url: str) -> str:
    """Display brand for a ``base_url``; ``""`` when nothing sensible is known.

    Never raises: this runs inside the extraction loop where a malformed URL
    from a forum post must degrade to "no provider", not abort the cycle.
    """
    try:
        host = _host(base_url)
    except Exception:  # pragma: no cover - defensive: _host is total
        return ""
    if not host:
        return ""
    if any(marker in host for marker in _PRIVATE_MARKERS):
        return ""
    bare = host[4:] if host.startswith("www.") else host
    for candidate in (host, bare):
        brand = PROVIDER_BRANDS.get(candidate)
        if brand:
            return brand
    # Relay station (or an unlisted first-party host): its own domain is the
    # honest label. A single-label host ("relay" in http://relay/v1) has no
    # public suffix and would read as a typo, so it is dropped.
    return bare if "." in bare else ""


def resolve_provider(key: str, base_url: str, prefix_provider: Optional[str] = None) -> str:
    """Provider label for a pair: key-prefix evidence first, host second.

    ``prefix_provider`` is passed in (instead of being computed here) so the
    caller keeps using the single source of truth in
    :func:`extract.credentials.provider_for_key`.
    """
    return (prefix_provider or "").strip() or provider_for_base_url(base_url)
