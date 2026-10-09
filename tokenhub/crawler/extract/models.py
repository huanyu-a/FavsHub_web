"""Model-name recognition for the public key cards (2026-10-09).

Why this module exists
----------------------
``token_keys.models`` (``TEXT DEFAULT '[]'``) has never been written by the
pipeline: the schema, the site API, the card's chip row
(``TokenKeyCard.vue`` "visibleModels" 前 3 + N) and the AI-service upsert all
carry the column, but no stage ever produced a value. On the live data the
column is ``[]`` for every row, so the chips never render and a user cannot
tell a DeepSeek giveaway from a Claude one without opening the original post.

Scope: what this recognises, and what it refuses to
---------------------------------------------------
A forum post announces the models it hands out ("无限deepseek", "Opus5.5-100刀",
"免费的grok4.6", "GLM模型Token大放送"). This module maps those **family
mentions** to canonical chip labels.

It is a display aid, not a contract:
  * only curated families are recognised - an unknown word is skipped, never
    guessed into a model name;
  * a version is kept only when the text states one (``grok4.6`` -> ``Grok
    4.6``); inventing "DeepSeek V3" from the word "deepseek" would be a claim
    the source never made;
  * URLs and credential-shaped tokens are stripped before matching, so
    ``/v1/models`` in a base_url or an ``sk-or-`` key never yields a chip;
  * the result is capped at :data:`MODELS_MAX` (the site's KEY_LIMITS contract:
    20 entries) and de-duplicated, order preserved.

Pure text in, list out: no network, no key material, never raises.
"""
from __future__ import annotations

import re
from typing import List, Sequence, Tuple

#: The site rejects more than 20 models per row (docs/08 §F4 KEY_LIMITS:
#: "models 20 条"). The crawler must not be able to build a row the site rejects.
MODELS_MAX = 20

#: Cap on how much text is scanned. Bodies are already truncated upstream
#: (TRUNCATED_BODY_LEN) and a full JSON-LD articleBody can be long; 8 KB is far
#: beyond any realistic model announcement and keeps the per-post cost flat.
SCAN_MAX_CHARS = 8192

#: Order matters: the first pattern that matches a span claims it, so a
#: family-specific pattern must precede a broader one ("claude-opus" before
#: "claude"). Each entry is ``(compiled pattern, canonical label)``; the pattern
#: may expose one optional version group which is appended to the label.
#:
#: Every pattern is word-bounded (``\b`` on ASCII, plus an explicit guard for
#: CJK neighbours) so "gpt" inside "gptgod" or "opus" inside a random handle
#: cannot match. Chinese text has no ASCII word boundaries - "GLM模型" and
#: "无限deepseek" are legitimate - so a following CJK character is explicitly
#: allowed rather than required to be a boundary.
_MODEL_PATTERNS: Sequence[Tuple[re.Pattern, str]] = (
    # --- Claude family -----------------------------------------------------
    (re.compile(r"(?i)(?<![a-z0-9])claude[\s\-_.]?(?:3|4|5)?[\s\-_.]?opus(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Claude Opus"),
    (re.compile(r"(?i)(?<![a-z0-9])opus(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Claude Opus"),
    (re.compile(r"(?i)(?<![a-z0-9])claude[\s\-_.]?(?:3|4|5)?[\s\-_.]?sonnet(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Claude Sonnet"),
    (re.compile(r"(?i)(?<![a-z0-9])sonnet(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Claude Sonnet"),
    (re.compile(r"(?i)(?<![a-z0-9])claude[\s\-_.]?(?:3|4|5)?[\s\-_.]?haiku(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Claude Haiku"),
    (re.compile(r"(?i)(?<![a-z0-9])haiku(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Claude Haiku"),
    # --- OpenAI family -----------------------------------------------------
    (re.compile(r"(?i)(?<![a-z0-9])gpt[\s\-_.]?4o(?![a-z0-9])"), "GPT-4o"),
    (re.compile(r"(?i)(?<![a-z0-9])gpt[\s\-_.]?4(?:\.\d)?(?![\w.])"), "GPT-4"),
    (re.compile(r"(?i)(?<![a-z0-9])gpt[\s\-_.]?5(?:\.\d)?(?![a-z0-9])"), "GPT-5"),
    (re.compile(r"(?i)(?<![a-z0-9])o([134])(?:[\s\-_.]mini)?(?![a-z0-9])"), "o{}"),
    # --- Other families ----------------------------------------------------
    (re.compile(r"(?i)(?<![a-z0-9])deepseek(?:[\s\-_.]?(?:v|r)?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "DeepSeek"),
    (re.compile(r"(?i)(?<![a-z0-9])grok(?:[\s\-_.]?v?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Grok"),
    (re.compile(r"(?i)(?<![a-z0-9])gemini(?:[\s\-_.]?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Gemini"),
    (re.compile(r"(?i)(?<![a-z0-9])(?:chat)?glm(?:[\s\-_.]?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "GLM"),
    (re.compile(r"(?i)(?<![a-z0-9])qwen(?:[\s\-_.]?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Qwen"),
    (re.compile(r"(?i)(?<![a-z0-9])kimi(?:[\s\-_.]?k?(\d+(?:\.\d+)?))?(?![a-z0-9])"), "Kimi"),
    (re.compile(r"(?i)(?<![a-z0-9])moonshot(?![a-z0-9])"), "Kimi"),
    (re.compile(r"(?i)(?<![a-z0-9])llama[\s\-_.]?(\d+(?:\.\d+)?)?(?![a-z0-9])"), "Llama"),
    (re.compile(r"(?i)(?<![a-z0-9])mistral(?![a-z0-9])"), "Mistral"),
    (re.compile(r"(?i)(?<![a-z0-9])minimax(?![a-z0-9])"), "MiniMax"),
    (re.compile(r"(?i)(?<![a-z0-9])doubao(?![a-z0-9])"), "Doubao"),
    (re.compile(r"(?i)(?<![a-z0-9])ernie(?![a-z0-9])"), "ERNIE"),
    (re.compile(r"(?i)(?<![a-z0-9])hunyuan(?![a-z0-9])"), "Hunyuan"),
)

#: Chinese aliases -> canonical label. CJK has no word boundary, so these are
#: plain substring matches; they are unambiguous multi-character brands.
_CJK_ALIASES: Sequence[Tuple[str, str]] = (
    ("深度求索", "DeepSeek"),
    ("通义千问", "Qwen"),
    ("智谱", "GLM"),
    ("豆包", "Doubao"),
    ("文心一言", "ERNIE"),
    ("混元", "Hunyuan"),
    ("月之暗面", "Kimi"),
)

#: Stripped before matching so a URL path or a key can never become a chip.
_URL_STRIP_RE = re.compile(r"https?://\S+")
_KEY_STRIP_RE = re.compile(r"\b(?:sk|gsk|xai|fw|AIza)[-_A-Za-z0-9]{16,}\b")

#: The ops family ("o1"/"o3"/"o4") is only a model name next to a model word:
#: "o3" alone is a chemical formula, a version tag or a random handle.
_OPS_CONTEXT_RE = re.compile(
    r"(?i)(?:gpt|openai|model|模型|推理|上下文|系列|会议|omni|chat)[^\n]{0,12}$")


def _clean(text: str) -> str:
    """Drop URLs and credential-shaped runs so they cannot be mistaken for models."""
    if not text:
        return ""
    out = _URL_STRIP_RE.sub(" ", text[:SCAN_MAX_CHARS])
    return _KEY_STRIP_RE.sub(" ", out)


def _label(base: str, version: str) -> str:
    """Append a version only when the source actually stated one."""
    version = (version or "").strip()
    return f"{base} {version}" if version else base


def find_model_mentions(text: str) -> List[str]:
    """Canonical model labels mentioned in ``text``, order preserved, capped.

    Returns ``[]`` for empty / unrecognisable text. Never raises: a malformed
    body must degrade to "no models", not abort the extraction cycle.
    """
    try:
        haystack = _clean(text)
    except Exception:  # pragma: no cover - _clean is total
        return []
    if not haystack:
        return []

    found: List[str] = []
    seen: set = set()

    def _add(label: str) -> None:
        if label and label not in seen and len(found) < MODELS_MAX:
            seen.add(label)
            found.append(label)

    for alias, canonical in _CJK_ALIASES:
        if alias in haystack:
            _add(canonical)

    for pattern, base in _MODEL_PATTERNS:
        for match in pattern.finditer(haystack):
            if base == "o{}":
                # ops family needs a model-ish neighbour to count
                start = match.start()
                if not _OPS_CONTEXT_RE.search(haystack[max(0, start - 24):start]):
                    continue
                _add(f"o{match.group(1)}")
                continue
            groups = match.groups()
            version = groups[0] if groups else ""
            _add(_label(base, version or ""))
            if len(found) >= MODELS_MAX:
                break
        if len(found) >= MODELS_MAX:
            break

    return found
