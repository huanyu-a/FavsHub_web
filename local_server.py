"""Local read-only preview site for the tokenhub P0 crawler (not part of P0 code).

Serves crawler/data/ statically plus live, read-only rendered pages from
crawler/data/tokenhub.db so the results can be inspected without any server
deployment (user constraint 2026-09-29: local only, nothing pushed).

Visual language mirrors the user's FavsHub site (favshub-nuxt, tokens page):
design tokens from public/css/tokens.css, header structure from
pages/tokens/index.vue, card anatomy from components/tokens/TokenDealCard.vue,
fact-grid / row styles from TokenDealDetail.vue. Single-file, stdlib only,
no external CSS/JS/fonts; header icons are inline SVG with currentColor.

Red lines honoured (07 §8.5): never renders key_encrypted / error_message_raw /
key_hash; keys are shown only in the pre-masked key_masked form; every dynamic
text passes a plaintext-key scrub (07 §8.2 shapes) before html-escaping; the
SQLite files themselves are refused (403) by the static passthrough; deal_status
'hidden' rows are filtered out of every read (07 §8.5 item 5); bound to 127.0.0.1.

Run from the repo root:
    python local_server.py             # serve http://127.0.0.1:8018/ (read-only)
    python local_server.py --selftest  # render every page, assert the invariants
"""
from __future__ import annotations

import html
import json
import os
import re
import sqlite3
import sys
from datetime import datetime
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "crawler", "data")
DB_PATH = os.path.join(DATA_DIR, "tokenhub.db")
HOST, PORT = "127.0.0.1", 8018

# Credential shapes scrubbed before any dynamic text reaches a page. Built from
# the 07 §8.2 layered regex (docs/07-最终执行方案.md:271): the vendor prefixes
# plus the generic `sk-` catch-all (the one live key is `sk-NoN…`, which no
# vendor sub-prefix covers) and the 07 §8.2:277 "备查" prefixes.
# A masked key (`sk-NoN***…jlgs`) contains `*`, which stops the {10,220} tail,
# so key_masked survives the scrub untouched.
PLAIN_KEY_RE = re.compile(
    r"(?<![A-Za-z0-9_\-])(?:"
    r"sk-(?:or-v1|ant(?:-api\d{2})?|proj|svcacct|admin|live|test)-?"
    r"|sk-|gsk_|xai-|fw_|hf_|pplx-|r8_|csk-|AIza|nvapi-|ghp_"
    r")[A-Za-z0-9_\-]{10,220}"
)
# Basenames that must never leave through the static passthrough: the SQLite
# database carries key_hash (incl. the guide sentinels) and the live key's
# Fernet ciphertext (red line 07 §8.5 / 07:401).
DENY_BASENAME_RE = re.compile(r"\.(?:db|sqlite3?)\b")
# A bare `key=value` token inside manual_queue.detail ("rule=D-keyword", "verdict=unknown").
KV_TOKEN_RE = re.compile(r"^[a-z][a-z0-9_]*=\S+$")
# Trailing " | <thread url>" in manual_queue.detail: already shown by the 来源帖 column.
TRAILING_URL_RE = re.compile(r"\s*\|\s*https?://\S+\s*$")

# Authoritative verdict enum lives in crawler/interfaces.py VERDICTS (07 §8.4).
# Class + Chinese label per badge; anything unmapped falls back to muted.
VERDICT_META = {
    "valid": ("ok", "有效"),
    "limited": ("warn", "受限可用"),
    "quota": ("warn", "额度受限"),
    "restricted": ("warn", "受限"),
    "blocked_by_waf": ("warn", "WAF 拦截"),
    "dead": ("bad", "失效"),
    "unknown": ("muted", "未知"),
    "endpoint_unsupported": ("muted", "端点不支持"),
    # Defensive: not in the current enum but tolerated by the probe layer.
    "quota_exceeded": ("warn", "额度耗尽"),
}

# (key, base_url) pairing confidence (crawler/interfaces.py:70 / 07 §8.2).
# Only meaningful for rows that have a key; C-class guides get no badge.
CONF_META = {
    "high": ("ok", "置信 · 高"),
    "medium": ("warn", "置信 · 中"),
    "low": ("muted", "置信 · 低"),
}

SOURCE_META = {
    "post": ("ok", "帖子直提取"),
    "aggregator_leak": ("muted", "聚合源泄漏"),
    "reply_visible_guide": ("guide", "回帖解锁指引"),
}

# Site root per source_id, used to build thread links and to name a card when the
# row carries neither provider nor base_url. linux.sb is the only P0 source and
# the /topic/{tid} shape is the one crawler/sources/linux_sb.py:94
# TOPIC_URL_TEMPLATE builds.
SOURCE_SITE = {"linux_sb": "https://linux.sb"}

# manual_queue.reason -> Chinese label + badge class. Keys mirror
# crawler/interfaces.py:89-95 MANUAL_REASONS; anything unmapped falls back to muted.
REASON_META = {
    "low_confidence_classify": ("muted", "低置信分类"),
    "low_confidence_pairing": ("muted", "配对低置信"),
    "suspected_valuable_E": ("info", "E 类疑似有价值"),
    "card_or_paid_benefit_info": ("warn", "卡密/付费福利"),
    "unknown_5_rounds": ("bad", "连续 5 轮未识别"),
}

# English diagnostic clauses the classify engine writes into manual_queue.detail
# (crawler/classify/engine.py); the page shows Chinese, the raw string stays in
# the cell tooltip. Patterns are matched on the whole detail string so the
# engine's own "(02 §D.7 …)" citation cannot split a clause. Verified against all
# 200 stored details, 2026-09-29.
DETAIL_PROSE_ZH = (
    (re.compile(r"benefit vocabulary in an otherwise unclaimed post"),
     "帖内命中福利词表，且帖内未发现凭证"),
    (re.compile(r"keyword fallback\s*"), "关键词兜底："),
    # The matched keyword leads the engine's sentence ("积分 also occurs …"); it is
    # cited back so the clause cannot read as a continuation of the keyword list.
    (re.compile(r"([^\s;]+)\s+also occurs in lottery posts\s*(?:\([^)]*\)\s*)?"),
     r"其中「\1」同样出现在抽奖/盖楼帖中"),
    (re.compile(r"\s*so the hit is low confidence"), "，因此判定命中置信低"),
)
#: English leftovers that must never survive into a detail cell. Enforced by
#: ``python local_server.py --selftest`` (see selftest()).
DETAIL_EN_STOPWORDS = (
    "the ", "also ", "occurs", "otherwise", "unclaimed", "vocabulary", "benefit ",
    "fallback", " hit ", "lottery", "manual_queue",
)

QUEUE_STATUS_META = {
    "pending": ("warn", "待复核"),
    "resolved": ("ok", "已复核"),
    "rejected": ("bad", "已驳回"),
}

# Design tokens: verbatim from favshub-nuxt/public/css/tokens.css :root.
# light-dark() is downgraded to a prefers-color-scheme media override (guide §4.3).
STYLE = """
:root {
  color-scheme: light dark;
  --primary: #059669;
  --primary-hover: #047857;
  --primary-light: rgba(5,150,105,0.08);
  --primary-medium: rgba(5,150,105,0.15);
  --primary-dark: #065F46;
  --surface: #F8F7F4;
  --surface-raised: #FCFBF9;
  --surface-sunken: #F1F0EC;
  --surface-hover: #F5F5F0;
  --surface-active: #E5E5E0;
  --surface-selected: rgba(5,150,105,0.10);
  --text-primary: #1F2937;
  --text-secondary: #4B5563;
  --text-tertiary: #9CA3AF;
  --text-quaternary: #D1D5DB;
  --text-inverse: #ffffff;
  --border: rgba(31,41,55,0.08);
  --border-focus: rgba(79,70,229,0.4);
  --divider: rgba(31,41,55,0.06);
  --overlay: rgba(0,0,0,0.4);
  --shadow-color: rgba(15,23,42,0.07);
  --shadow-sm: 0 1px 3px var(--shadow-color);
  --shadow-md: 0 4px 12px var(--shadow-color);
  --shadow-lg: 0 12px 40px var(--shadow-color);
  --shadow-xl: 0 20px 60px var(--shadow-color);
  --accent-blue: #3B82F6;
  --accent-purple: #764ba2;
  --accent-red: #EF4444;
  --accent-yellow: #F59E0B;
  --success: #10B981;
  --danger: #EF4444;
  --warning: #F59E0B;
  --danger-soft: color-mix(in srgb, var(--danger) 10%, var(--surface-raised));
  --warning-soft: color-mix(in srgb, var(--warning) 15%, transparent);
  --success-soft: color-mix(in srgb, var(--success) 12%, transparent);
  --info-soft: color-mix(in srgb, var(--accent-blue) 12%, transparent);
  --neutral-soft: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 20px;
  --font-system: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif;
  --font-mono: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --primary: #34D399;
    --primary-hover: #10B981;
    --primary-light: rgba(52,211,153,0.12);
    --primary-medium: rgba(52,211,153,0.2);
    --primary-dark: #059669;
    --surface: #0F172A;
    --surface-raised: #1E293B;
    --surface-sunken: #0B1120;
    --surface-hover: rgba(51,65,85,0.6);
    --surface-active: rgba(71,85,105,0.8);
    --surface-selected: rgba(52,211,153,0.15);
    --text-primary: #E2E8F0;
    --text-secondary: #94A3B8;
    --text-tertiary: #64748B;
    --text-quaternary: #475569;
    --text-inverse: #0F172A;
    --border: #334155;
    --border-focus: rgba(96,165,250,0.4);
    --divider: rgba(255,255,255,0.06);
    --overlay: rgba(0,0,0,0.6);
    --shadow-color: rgba(0,0,0,0.42);
    --accent-blue: #60A5FA;
    --accent-purple: #a78bfa;
    --accent-red: #F87171;
    --accent-yellow: #FBBF24;
    --success: #3FB950;
    --danger: #F85149;
    --warning: #D29922;
  }
}

* { box-sizing: border-box; }
body {
  font-family: var(--font-system);
  margin: 0;
  background: var(--surface);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 6px;
}

/* ── Sticky top bar (pattern A of favshub pages/tokens/index.vue) ── */
.site-header {
  width: 100%;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.site-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.site-header-left { display: flex; align-items: center; gap: 12px; }
/* logo block: 26×26, 6px radius, hover opacity .7 (favshub .tokens-header-logo) */
.site-header-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  text-decoration: none;
  border-radius: 6px;
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.site-header-logo:hover { opacity: 0.7; text-decoration: none; }
.site-header-logo:active { opacity: 0.6; }
.site-logo {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--primary);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}
.site-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.site-nav { display: flex; align-items: center; gap: 2px; flex-wrap: nowrap; }
.site-nav-link {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.site-nav-link svg { width: 15px; height: 15px; opacity: 0.7; flex-shrink: 0; }
.site-nav-link:hover { background: var(--surface-hover); color: var(--text-primary); text-decoration: none; }
.site-nav-link:hover svg { opacity: 1; }
.site-nav-link:active { background: var(--surface-active); }
.site-nav-link.active { color: var(--primary); background: var(--primary-light); }
.site-nav-link.active svg { opacity: 1; }

.page { max-width: 1200px; margin: 0 auto; padding: 24px; }

/* ── Hero panel (tokens-page hero, restrained neutral shell) ── */
.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px 24px;
  flex-wrap: wrap;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: 20px;
}
.hero-text { flex: 1 1 320px; min-width: 0; }
.hero-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
.hero-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  max-width: 560px;
  color: var(--text-secondary);
}
.hero-tools { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; flex: 0 1 auto; }
.hero-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.hero-chip .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  flex-shrink: 0;
}
/* same chip anatomy, as a link (reports page -> feed.xml entry) */
a.hero-chip {
  color: var(--text-secondary);
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
a.hero-chip:hover {
  background: var(--surface-hover);
  border-color: var(--border-focus);
  color: var(--text-primary);
  text-decoration: none;
}

/* ── Badges: soft background + same-color text, 6px radius, 12px ── */
.badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
}
.badge.ok { background: var(--success-soft); color: var(--success); }
.badge.warn { background: var(--warning-soft); color: var(--warning); }
.badge.bad { background: var(--danger-soft); color: var(--danger); }
.badge.muted { background: var(--neutral-soft); color: var(--text-tertiary); }
.badge.info, .badge.guide { background: var(--info-soft); color: var(--accent-blue); }

.chip {
  display: inline-block;
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip.is-more { color: var(--text-tertiary); }

/* bare `key=value` token inside a queue detail cell */
.kv-chip {
  display: inline-block;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  padding: 1px 6px;
  border-radius: 6px;
  margin-right: 4px;
  white-space: nowrap;
}

/* ── Metric cards (tdd-fact enlarged, favshub TokenDealDetail.vue) ── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 10px;
  background: var(--surface-sunken);
}
.stat-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.stat-label .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.stat-hint { font-size: 11px; color: var(--text-tertiary); }

/* ── Section title (TokenDealDetail .section-title) ── */
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

/* ── Skin for tables (queue / watermark): no solid grid boxes ── */
.table-wrap {
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  overflow-x: auto;
  margin-bottom: 28px;
}
table { border-collapse: collapse; width: 100%; font-size: 13px; }
thead th {
  background: var(--surface-sunken);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  padding: 9px 14px;
  white-space: nowrap;
}
tbody td {
  padding: 9px 14px;
  color: var(--text-secondary);
  vertical-align: top;
  border-top: 0.5px solid var(--divider);
}
tbody tr:first-child td { border-top: none; }
tbody tr:hover td { background: var(--surface-hover); }
.cell-muted { color: var(--text-tertiary); }
.cell-num { font-variant-numeric: tabular-nums; white-space: nowrap; }
/* Detail cell: structured chips + the post title; the full raw engine string
   stays in the cell tooltip, so clipping here never hides information. */
.cell-detail { max-width: 560px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ── Key snapshot card grid (deal-card variant) ── */
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}
.deal-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.deal-card:hover {
  border-color: var(--border-focus);
  background: var(--surface-hover);
  box-shadow: var(--shadow-md);
}
.deal-card.is-dead { opacity: 0.6; }
.deal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.deal-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.deal-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  box-shadow: inset 0 0 0 1px var(--border);
}
.deal-brand-text { min-width: 0; }
.deal-provider {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.deal-meta { margin: 0; font-size: 12px; color: var(--text-tertiary); }
/* top-right badge slot = favshub .deal-quality position; holds the confidence badge */
.deal-side { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-shrink: 0; flex-wrap: wrap; }
.deal-meta .sep { color: var(--text-quaternary); }
.deal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

/* Masked-key block reuses the quota-block anatomy: 3px accent bar + sunken bg */
.key-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-sunken));
  border-left: 3px solid color-mix(in srgb, var(--primary) 75%, transparent);
}
.key-block .key-label { font-size: 12px; color: var(--text-tertiary); }
.key-block .key-value {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.guide-block {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--info-soft);
  border-left: 3px solid color-mix(in srgb, var(--accent-blue) 75%, transparent);
  font-size: 12px;
  color: var(--accent-blue);
}
.deal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  min-width: 0;
}
/* 64px grey label column, per favshub .tdd-row label width (guide §2.2) */
.deal-row .row-label { flex-shrink: 0; min-width: 64px; color: var(--text-tertiary); }
.deal-row .row-code {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.deal-row .row-link {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deal-models { display: flex; flex-wrap: wrap; gap: 6px; }
.deal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 0.5px solid var(--divider);
  font-size: 12px;
}
.deal-foot .foot-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.deal-foot .fail-count { color: var(--warning); font-variant-numeric: tabular-nums; }
.deal-foot .probe-time { color: var(--text-tertiary); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }

/* ── Static count row: the .filter-tabs anatomy of favshub TokenFilterBar.vue
     (86-119) with no .active tab — this strip is a summary, not a filter, so
     every pill keeps the unselected look (transparent, no shadow) and only the
     count is emphasised. ── */
.pill-strip {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-sunken);
  border-radius: 10px;
  width: fit-content;
  max-width: 100%;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  background: none;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pill b { font-weight: 600; color: var(--text-primary); }

/* ── Directory listing (reports/) ── */
.dir-list {
  list-style: none;
  margin: 0 0 28px;
  padding: 4px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
}
.dir-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.dir-list li + li { border-top: 0.5px solid var(--divider); }
.dir-list li:hover { background: var(--surface-hover); }
.dir-list .dir-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir-list .dir-meta { color: var(--text-tertiary); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.dir-list .dir-name .dir-slash { color: var(--text-quaternary); }
/* Entry the static passthrough refuses (SQLite): visible, but not a link. */
.dir-list li.is-denied .dir-name { color: var(--text-tertiary); }
.dir-list li.is-denied:hover { background: none; }

/* ── Footnote strip: crawl watermark demoted to a footnote (guide §4.4) ── */
.footnote {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.footnote .footnote-label { font-size: 11px; color: var(--text-tertiary); }
.footnote .footnote-item { font-variant-numeric: tabular-nums; }
.footnote .footnote-item b { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.footnote .sep { color: var(--text-quaternary); }

/* ── Empty state (tokens-page .empty-state) ── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  color: var(--text-tertiary);
  background: var(--surface-raised);
  border: 1px dashed var(--border);
  border-radius: 14px;
  margin-bottom: 28px;
}
.empty-state .empty-icon { font-size: 36px; line-height: 1; margin-bottom: 8px; }
.empty-state p { font-size: 14px; font-weight: 500; margin: 0; }
.empty-state span { font-size: 12px; margin-top: 4px; }
.empty-state a { font-size: 12px; margin-top: 10px; }

/* ── Footer note (data red line reminder) ── */
.page-note { color: var(--text-tertiary); font-size: 12px; margin: 0 0 28px; line-height: 1.6; }
.page-note code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface-sunken);
  padding: 1px 6px;
  border-radius: 6px;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .site-header-inner { padding: 0 12px; }
  .site-title { font-size: 14px; }
  .page { padding: 16px 12px; }
  .card-grid, .stat-grid { grid-template-columns: 1fr; }
  .hero { padding: 16px 16px; }
  .cell-detail { max-width: 220px; }
}
"""

# Inline 15px stroke icons (currentColor) for the header nav, mirroring the
# linear SVG icons of the favshub tokens header.
_ICONS = {
    "home": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    "key": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4"/><path d="M10.5 12.5L20 3M15.5 7.5l3 3M12.5 10.5l2 2"/></svg>',
    "queue": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="2.4"/></svg>',
    "report": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    "feed": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>',
}

NAV_ITEMS = (
    ("/", "概览", "home"),
    ("/keys", "Key 快照", "key"),
    ("/queue", "人工队列", "queue"),
    ("/reports/", "日报", "report"),
    ("/feed.xml", "feed.xml", "feed"),
)


def scrub(text: str) -> str:
    """Replace any plaintext credential shape before it reaches a page."""
    return PLAIN_KEY_RE.sub("[已脱敏]", text)


def esc1(text: object) -> str:
    return html.escape(scrub(str(text if text is not None else "")))


def db_rows(sql: str, args: tuple = ()) -> list[dict]:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def badge(text: str, cls: str) -> str:
    return f"<span class='badge {cls}'>{esc1(text)}</span>"


def verdict_label(verdict: object) -> tuple[str, str]:
    """(badge class, Chinese label) for a probe verdict; unmapped values stay raw."""
    v = str(verdict or "unknown")
    return VERDICT_META.get(v, ("muted", v))


def verdict_badge(verdict: object) -> str:
    cls, label = verdict_label(verdict)
    return badge(label, cls)


def confidence_badge(confidence: object) -> str:
    c = str(confidence or "").strip()
    if not c:
        return ""
    cls, label = CONF_META.get(c, ("muted", f"置信 · {c}"))
    return badge(label, cls)


def source_badge(source: object) -> str:
    cls, label = SOURCE_META.get(str(source or ""), ("muted", str(source or "未知来源")))
    return badge(label, cls)


def reason_badge(reason: object) -> str:
    r = str(reason or "")
    cls, label = REASON_META.get(r, ("muted", r))
    return badge(label, cls)


def status_badge(status: object) -> str:
    s = str(status or "")
    cls, label = QUEUE_STATUS_META.get(s, ("muted", s))
    return badge(label, cls)


def domain_of(url: object) -> str:
    """Host of a base_url/source_url, e.g. https://max.ai.com/x -> max.ai.com."""
    try:
        host = urlsplit(str(url or "")).netloc
    except ValueError:
        return ""
    return host.split("@")[-1].split(":")[0]


def source_site_host(row: dict) -> str:
    """Host of the forum a row came from (source_url first, then the source_id map)."""
    host = domain_of(row.get("source_url"))
    if host:
        return host
    return domain_of(SOURCE_SITE.get(str(row.get("source_id") or "").strip(), ""))


def topic_url(row: dict) -> str:
    """Thread link: trust the stored source_url, else rebuild it from the source map."""
    url = str(row.get("source_url") or "").strip()
    if url.startswith(("http://", "https://")):
        return url
    site = SOURCE_SITE.get(str(row.get("source_id") or "").strip(), "")
    tid = row.get("source_tid")
    return f"{site}/topic/{tid}" if site and tid else ""


def short_link_text(url: object) -> str:
    """Compact label for a thread link, e.g. linux.sb/topic/23732."""
    host = domain_of(url)
    if not host:
        return str(url or "")
    path = urlsplit(str(url)).path.rstrip("/")
    return f"{host}{path}" if path else host


def _local_dt(value: object) -> datetime | None:
    """Seconds-epoch -> datetime in local tz; None for null/zero/absurd values."""
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    try:
        return datetime.fromtimestamp(ts)
    except (OSError, OverflowError, ValueError):
        return None


def fmt_date(value: object) -> str:
    """Seconds-epoch -> YYYY-MM-DD (local tz), matching favshub formatTime."""
    dt = _local_dt(value)
    return dt.strftime("%Y-%m-%d") if dt else ""


def fmt_datetime(value: object) -> str:
    """Seconds-epoch -> YYYY-MM-DD HH:MM (local tz)."""
    dt = _local_dt(value)
    return dt.strftime("%Y-%m-%d %H:%M") if dt else ""


def probe_time_text(row: dict) -> str:
    """Card footer right side: probe date, else first-seen date, else em dash."""
    if row.get("last_probe_at"):
        return f"探测 {fmt_date(row['last_probe_at'])}"
    if row.get("first_seen_at"):
        return f"发现 {fmt_date(row['first_seen_at'])}"
    return "—"


def display_name(row: dict) -> str:
    """Card header name: provider, else base_url host, else the forum, else source_id."""
    candidates = (
        row.get("provider"),
        domain_of(row.get("base_url")),
        source_site_host(row),
        row.get("source_id"),
    )
    for candidate in candidates:
        text = str(candidate or "").strip()
        if text:
            return text
    return "?"


def parse_models(raw: object) -> list[str]:
    try:
        data = json.loads(raw) if raw else []
    except (TypeError, ValueError):
        return []
    return [str(m) for m in data if str(m).strip()] if isinstance(data, list) else []


def site_header(active: str) -> str:
    links = []
    for href, label, icon in NAV_ITEMS:
        cls = "site-nav-link active" if href == active else "site-nav-link"
        links.append(f"<a class='{cls}' href='{href}'>{_ICONS[icon]}<span>{label}</span></a>")
    return (
        "<header class='site-header'><div class='site-header-inner'>"
        "<div class='site-header-left'>"
        "<a class='site-header-logo' href='/' aria-label='TokenHub 本地预览首页'>"
        "<span class='site-logo'>T</span><h1 class='site-title'>TokenHub 本地预览</h1></a></div>"
        f"<nav class='site-nav' aria-label='页面导航'>{''.join(links)}</nav>"
        "</div></header>"
    )


def page(title: str, body: str, active: str = "/") -> str:
    return (
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{esc1(title)}</title><style>{STYLE}</style></head>"
        f"<body>{site_header(active)}<main class='page'>{body}</main></body></html>"
    )


def hero(title: str, sub: str, chips: tuple[str, ...] = ()) -> str:
    """Hero panel; plain chips get the .hero-chip shell, an <a> chip brings its own."""
    chip_html = "".join(
        c if c.lstrip().startswith("<a") else f"<span class='hero-chip'>{c}</span>"
        for c in chips)
    tools = f"<div class='hero-tools'>{chip_html}</div>" if chip_html else ""
    return (
        "<div class='hero'><div class='hero-text'>"
        f"<h2 class='hero-title'>{esc1(title)}</h2>"
        f"<p class='hero-sub'>{esc1(sub)}</p>"
        f"</div>{tools}</div>"
    )


def empty_state(icon: str, title: str, sub: str = "", extra: str = "") -> str:
    """favshub .empty-state panel: dashed raised box, 36px icon slot, two lines."""
    sub_html = f"<span>{esc1(sub)}</span>" if sub else ""
    return (f"<div class='empty-state'><div class='empty-icon'>{esc1(icon)}</div>"
            f"<p>{esc1(title)}</p>{sub_html}{extra}</div>")


def render_home() -> str:
    # Takedown flow 07 §8.5 item 5 names deal_status='hidden' for rows pulled on
    # a rights-holder notice: read paths filter hidden by default.
    keys = db_rows("SELECT source, verdict, confidence FROM token_keys"
                   " WHERE deal_status = 'published'")
    guides = sum(1 for r in keys if r["source"] == "reply_visible_guide")
    creds = len(keys) - guides
    dead = sum(1 for r in keys if r["verdict"] == "dead")
    # Same measure as the /queue hero (pending only), so the two pages agree
    # once rows start getting resolved.
    queued = db_rows("SELECT count(*) c FROM manual_queue WHERE status = 'pending'")[0]["c"]
    states = db_rows("SELECT source_id, last_tid, updated_at FROM crawl_state")
    newest = max((int(s["updated_at"] or 0) for s in states), default=0)

    stats = (
        "<div class='stat-grid'>"
        "<div class='stat-card'><span class='stat-label'>"
        "<span class='dot' style='background:var(--primary)'></span>已提取 key</span>"
        f"<span class='stat-value'>{creds}</span>"
        "<span class='stat-hint'>帖子直提取，脱敏展示</span></div>"
        "<div class='stat-card'><span class='stat-label'>"
        "<span class='dot' style='background:var(--accent-blue)'></span>回帖解锁指引</span>"
        f"<span class='stat-value'>{guides}</span>"
        "<span class='stat-hint'>C 类帖，原帖回帖后可见</span></div>"
        "<div class='stat-card'><span class='stat-label'>"
        "<span class='dot' style='background:var(--warning)'></span>人工队列待复核</span>"
        f"<span class='stat-value'>{queued}</span>"
        "<span class='stat-hint'>低置信分类、卡密福利、E 类疑似有价值</span></div>"
        "<div class='stat-card'><span class='stat-label'>"
        "<span class='dot' style='background:var(--danger)'></span>已判失效</span>"
        f"<span class='stat-value'>{dead}</span>"
        "<span class='stat-hint'>探测判定 verdict=dead</span></div>"
        "</div>"
    )

    # Watermark is reference data, not a headline: one footnote line per source.
    items = "".join(
        "<span class='footnote-item'>{}{} <b>{}</b>{}更新 {}</span>".format(
            esc1(s["source_id"]),
            "<span class='sep'> · </span>last_tid",
            esc1(s["last_tid"] if s["last_tid"] is not None else "—"),
            "<span class='sep'> · </span>",
            esc1(fmt_datetime(s["updated_at"]) or "—"))
        for s in states)
    watermark = f"<p class='footnote'><span class='footnote-label'>抓取水位</span>{items}</p>" if items else ""

    chips = ["<span class='dot'></span>只读 · 本地数据"]
    if newest:
        chips.append(f"数据截至 {esc1(fmt_datetime(newest))}")
    body = (
        hero("tokenhub P0 概览", "本地只读预览：来自第三方论坛公开帖的 API 凭证快照与人工复核队列，"
             "仅供测试，如有侵权请联系删除（07 §8.5）。刷新页面即读取最新数据库。", tuple(chips))
        + stats + watermark
        + "<p class='page-note'>抓取由计划任务 <code>tokenhub-crawler</code>（每 3 小时一轮）或手动 "
          "<code>python crawler/main.py --once</code> 触发；本页每次刷新实时只读数据库，"
          "明文 key 绝不出库（07 §8.5）。</p>"
    )
    return page("tokenhub P0 概览", body, active="/")


def _key_card(row: dict) -> str:
    """One deal-card per token_keys row (guide §2.5 field mapping, §4.4 layout).

    B-class key row: masked key in a mono block, API address row, thread link.
    C-class guide row: info-soft lock block instead of a key; never a key value.
    Red line 07 §8.5: key_masked only — key_encrypted / key_hash / error_message_raw
    are never selected from the DB, let alone rendered.
    """
    is_guide = row.get("source") == "reply_visible_guide"
    name = display_name(row)
    initial = esc1(name[:1].upper() or "?")
    site_host = source_site_host(row)

    meta_parts = [source_badge(row.get("source"))]
    # Skip the host when it already is the display name (C-class cards would
    # otherwise print "linux.sb" twice).
    if site_host and site_host != name:
        meta_parts.append(esc1(site_host))
    meta = "<span class='sep'> · </span>".join(meta_parts)

    # confidence = (key, base_url) pairing confidence (interfaces.py:70, 07 §8.2).
    # A C-class guide row has neither key nor base_url and main.py:705 hardcodes
    # "high" for it, so the badge would be meaningless — render it only for rows
    # that actually carry a credential.
    conf = "" if is_guide else confidence_badge(row.get("confidence"))
    head = (
        "<div class='deal-head'><div class='deal-brand'>"
        f"<span class='deal-icon'>{initial}</span>"
        "<div class='deal-brand-text'>"
        f"<h3 class='deal-provider'>{esc1(name)}</h3>"
        f"<p class='deal-meta'>{meta}</p>"
        "</div></div>"
        # favshub .deal-quality slot: our quality-ish field is the pairing confidence
        + (f"<div class='deal-side'>{conf}</div>" if conf else "")
        + "</div>"
    )

    title_text = (str(row.get("source_title") or "").strip()
                  or str(row.get("source_url") or "").strip() or "（无标题）")
    title = f"<h4 class='deal-title'>{esc1(title_text)}</h4>"

    masked = str(row.get("key_masked") or "").strip()
    if is_guide:
        block = "<div class='guide-block'>🔒 回帖解锁指引 · 需在原帖回复后可见</div>"
    elif masked:
        block = ("<div class='key-block'><span class='key-label'>脱敏 Key</span>"
                 f"<span class='key-value'>{esc1(masked)}</span></div>")
    else:
        block = ""

    base_url = str(row.get("base_url") or "").strip()
    api_row = ("<div class='deal-row'><span class='row-label'>API 地址</span>"
               f"<span class='row-code'>{esc1(base_url)}</span></div>") if base_url else ""

    source_url = str(row.get("source_url") or "").strip()
    if source_url:
        source_row = (
            "<div class='deal-row'><span class='row-label'>来源帖</span>"
            f"<a class='row-link' href='{esc1(source_url)}'>{esc1(short_link_text(source_url))} ↗</a></div>")
    else:
        source_row = ("<div class='deal-row'><span class='row-label'>来源帖</span>"
                      "<span class='row-link cell-muted'>—</span></div>")

    models = parse_models(row.get("models"))
    models_html = ""
    if models:
        chips = "".join(f"<span class='chip'>{esc1(m)}</span>" for m in models[:3])
        rest = len(models) - 3
        if rest > 0:
            chips += f"<span class='chip is-more'>+{rest}</span>"
        models_html = f"<div class='deal-models'>{chips}</div>"

    foot_parts = [verdict_badge(row.get("verdict"))]
    try:
        failures = int(row.get("consecutive_failures") or 0)
    except (TypeError, ValueError):
        failures = 0
    if failures > 0:
        foot_parts.append(f"<span class='fail-count'>连续失败 {failures} 次</span>")
    foot = ("<div class='deal-foot'><span class='foot-left'>" + "".join(foot_parts) + "</span>"
            f"<span class='probe-time'>{esc1(probe_time_text(row))}</span></div>")

    dead_cls = " is-dead" if str(row.get("verdict")) == "dead" else ""
    return (f"<article class='deal-card{dead_cls}'>{head}{title}{block}"
            f"{api_row}{models_html}{source_row}{foot}</article>")


def render_keys() -> str:
    # source_id is required: it is the last-resort card name and the flag lookup
    # for source_url-less rows. key_encrypted / key_hash / error_message_raw are
    # deliberately never selected (red line 07 §8.5).
    rows = db_rows(
        "SELECT id, source_id, source, source_tid, source_url, source_title, key_masked,"
        " base_url, provider, models, confidence, verdict, consecutive_failures,"
        " last_probe_at, first_seen_at"
        " FROM token_keys WHERE deal_status = 'published'"  # 07 §8.5 item 5
        " ORDER BY (source = 'post') DESC, last_probe_at DESC, first_seen_at DESC, id")
    guides = sum(1 for r in rows if r.get("source") == "reply_visible_guide")
    verdicts: dict[str, int] = {}
    for r in rows:
        key = str(r.get("verdict") or "unknown")
        verdicts[key] = verdicts.get(key, 0) + 1
    verdict_chip = " · ".join(
        f"{esc1(verdict_label(key)[1])} {count}"
        for key, count in sorted(verdicts.items(), key=lambda kv: -kv[1]))
    cards = "".join(_key_card(r) for r in rows)
    body = (
        hero("Key 快照", "内容来自第三方论坛公开帖，仅供测试，如有侵权请联系删除（07 §8.5）。"
             "每条记录一张卡：厂商/入口、脱敏 key、探测状态；真 key 仅以「前缀+星号+后缀」"
             "脱敏形态展示，指引类记录只给原帖链接。",
             ("<span class='dot'></span>只读快照 · 刷新即最新",
              f"共 {len(rows)} 条 · 真 key {len(rows) - guides} · 指引 {guides}",
              verdict_chip))
        + f"<div class='card-grid'>{cards}</div>"
        + "<p class='page-note'>「回帖解锁指引」= C 类帖：key 需在原帖回帖后可见，此处只给原帖链接。"
          "B 类真 key 以 <code>前缀+星号+后缀</code> 脱敏展示；明文只以 Fernet 密文存于本地库（07 §8.5）。</p>"
    )
    return page("Key 快照", body, active="/keys")


def detail_cell(detail: object) -> tuple[str, str]:
    """(cell html, tooltip) for one manual_queue.detail value.

    Stored details are machine strings the classify engine builds, e.g.
    ``rule=D-keyword category=D confidence=low; keyword fallback 兑换|积分; <title>``
    or ``rule=E-suspected-value category=E confidence=low; benefit vocabulary in
    an otherwise unclaimed post -> manual_queue reason=suspected_valuable_E``.
    Rendering rules:
      * the trailing ``-> manual_queue reason=…`` clause is dropped from the
        display: it is the engine's *proposed* re-file and it contradicts the
        原因 badge (the real ``reason`` column) on 91 of 200 rows, so showing
        both side by side reads as two different conclusions;
      * trailing ``| <thread url>`` is dropped (the 来源帖 column shows it);
      * ``(07 §…)`` spec citations are dropped;
      * every ``key=value`` token becomes a mono chip;
      * the known English diagnostic clauses are shown in Chinese;
      * the untouched raw value stays in the tooltip.
    """
    raw = str(detail or "").strip()
    shown = TRAILING_URL_RE.sub("", raw).strip()
    shown = re.split(r"\s*->\s*", shown, maxsplit=1)[0]
    for pattern, zh in DETAIL_PROSE_ZH:
        shown = pattern.sub(zh, shown)
    shown = re.sub(r"\s*\(0\d §[^)]*\)", "", shown)
    shown = re.sub(r"\s+([;，,])", r"\1", shown).strip() or raw
    parts = []
    for segment in shown.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        for token in segment.split():
            parts.append(f"<span class='kv-chip'>{esc1(token)}</span>"
                         if KV_TOKEN_RE.match(token) else esc1(token))
    return " ".join(parts), raw


def render_queue() -> str:
    # key_hash is deliberately never selected (red line 07 §8.5); nothing on this
    # page needs it.  Hash-shaped strings inside detail are scrubbed by esc1.
    rows = db_rows(
        "SELECT id, reason, source_id, source_tid, detail, status, created_at"
        " FROM manual_queue ORDER BY created_at DESC, id DESC LIMIT 200")

    if not rows:
        return page("人工队列", hero("人工队列", "队列为空。")
                    + empty_state("🗂", "暂无待复核条目", "分类引擎判定全部通过时不会写入队列"),
                    active="/queue")

    # Static pill strip: reason distribution for at-a-glance triage.
    counts: dict[str, int] = {}
    for r in rows:
        counts[r["reason"]] = counts.get(r["reason"], 0) + 1
    pills = "".join(
        "<span class='pill'>{} <b>{}</b></span>".format(reason_badge(reason), count)
        for reason, count in sorted(counts.items(), key=lambda kv: -kv[1])
    )

    pending = sum(1 for r in rows if r.get("status") == "pending")
    trs = []
    for r in rows:
        url = topic_url(r)
        tid = r.get("source_tid")
        if url:
            link = f"<a href='{esc1(url)}' target='_blank' rel='noopener noreferrer'>#{esc1(tid)} ↗</a>"
        else:
            link = "<span class='cell-muted'>—</span>"
        detail_html, detail_tip = detail_cell(r.get("detail"))
        trs.append(
            "<tr><td class='cell-muted cell-num'>{}</td><td>{}</td>"
            "<td class='cell-detail' title=\"{}\">{}</td><td>{}</td><td>{}</td>"
            "<td class='cell-muted cell-num'>{}</td></tr>".format(
                esc1(fmt_datetime(r.get("created_at")) or "—"),
                reason_badge(r.get("reason")),
                esc1(detail_tip),
                detail_html or "<span class='cell-muted'>—</span>",
                link,
                status_badge(r.get("status")),
                esc1(r.get("id"))))
    body = (
        hero("人工队列", "分类置信不足或疑似福利情报的帖子进入此队列，等待人工复核；"
             "P1 复盘后决定消化方式。",
             (f"最近 {len(rows)} 条 · 全部只读", f"待复核 {pending} 条"))
        + "<h3 class='section-title'>原因分布</h3>"
        + f"<div class='pill-strip'>{pills}</div>"
        + "<div class='table-wrap'><table><thead><tr><th>时间</th><th>原因</th><th>详情</th>"
          "<th>来源帖</th><th>状态</th><th>ID</th></tr></thead><tbody>"
        + "".join(trs)
        + "</tbody></table></div>"
        + "<p class='page-note'>悬停「详情」可看完整判定说明（含被判重掉的来源链接）；"
          "key 相关字段不参与本页查询，明文 key 绝不出库（07 §8.5）。</p>"
    )
    return page("人工队列", body, active="/queue")


def list_dir_names(path: str) -> list[str]:
    """Sorted entry names of a directory under DATA_DIR; [] when unreadable."""
    full = os.path.join(DATA_DIR, os.path.normpath(path.lstrip("/")))
    try:
        return sorted(os.listdir(full))
    except OSError:
        return []


def render_dir_listing(path: str, names: list[str]) -> str:
    base = os.path.join(DATA_DIR, os.path.normpath(path.lstrip("/")))
    items = []
    for name in names:
        full = os.path.join(base, name)
        is_dir = os.path.isdir(full)
        try:
            stat = os.stat(full)
            meta = "目录" if is_dir else f"{stat.st_size} B · {fmt_datetime(stat.st_mtime) or '—'}"
        except OSError:
            meta = ""
        if DENY_BASENAME_RE.search(name.lower()):
            # Same refusal the download path applies (07 §8.5): list the entry so
            # the directory still reads truthfully, but never as a link.
            items.append(f"<li class='is-denied'><span class='dir-name'>{esc1(name)}</span>"
                         f"<span class='dir-meta'>{esc1(meta)} · 🔒 不外传（403）</span></li>")
            continue
        slash = "<span class='dir-slash'>/</span>" if is_dir else ""
        href = esc1(path.rstrip("/") + "/" + name + ("/" if is_dir else ""))
        items.append(
            f"<li><a class='dir-name' href='{href}'>{esc1(name)}{slash}</a>"
            f"<span class='dir-meta'>{esc1(meta)}</span></li>")

    chips = ["<span class='dot'></span>静态目录 · 只读"]
    if os.path.isfile(os.path.join(DATA_DIR, "feed.xml")):
        chips.append("<a class='hero-chip' href='/feed.xml'>feed.xml · RSS 原文 ↗</a>")
    norm = "/" + path.strip("/") + ("/" if path.strip("/") else "")
    is_reports = norm == "/reports/"
    title = "日报目录" if is_reports else f"目录 · {norm}"
    subtitle = ("crawler 每轮抓取产出的文字日报（reports/*.txt）与附属文件，"
                "点击直接查看原文件（纯文本，按原文输出）。" if is_reports else
                "crawler/data/ 下的只读目录列表，点击进入下级或查看原文件（纯文本，按原文输出）。")
    page_head = hero(title, subtitle, tuple(chips))
    if items:
        body = page_head + f"<ul class='dir-list'>{''.join(items)}</ul>"
    else:
        body = page_head + empty_state("🗂", "暂无文件", "crawler 产出日报后会出现在这里")
    body += ("<p class='page-note'>目录内容来自 <code>crawler/data/</code>，服务器只做静态透传"
             "（数据库文件除外，见 🔒 标记）；明文 key 绝不出库（07 §8.5）。</p>")
    return page(title, body, active="/reports/" if is_reports else "")


def render_denied(path: str) -> str:
    """403 panel for crawler/data files that must never leave over HTTP."""
    body = (hero("文件不对外透传", "预览站只透传 crawler/data/ 下的日报、feed 与普通文本；"
                 "SQLite 库存有凭证指纹与密文，不出页面（07 §8.5）。")
            + empty_state("🔒", f"403 · {path}", "需要查数据请直接读本地库，不要在浏览器里下载"))
    return page("403 Forbidden", body, active="")


def render_404(path: str) -> str:
    body = (hero("页面不存在", "本地预览站只有顶部导航里的几页，外加 crawler/data/ 下的静态文件。")
            + empty_state("🗂", f"404 · {path}", "试试顶部导航，或回到概览页",
                          extra="<a href='/'>← 回到概览</a>"))
    return page("404 Not Found", body, active="")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        pass

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _html(self, text: str, code: int = 200) -> None:
        self._send(code, text.encode("utf-8"), "text/html; charset=utf-8")

    def do_GET(self) -> None:
        path = unquote(urlsplit(self.path).path)
        if path in ("/", "/index.html"):
            return self._html(render_home())
        if path in ("/keys", "/keys.html"):
            return self._html(render_keys())
        if path in ("/queue", "/queue.html"):
            return self._html(render_queue())
        # static files from crawler/data (feed.xml, reports/, index.html)
        rel = os.path.normpath(path.lstrip("/"))
        target = os.path.normpath(os.path.join(DATA_DIR, rel))
        # Prefix must stop at a path separator so sibling dirs (data2/…) can't pass.
        inside = target == DATA_DIR or target.startswith(DATA_DIR + os.sep)
        # Refuse the SQLite files outright: they hold key_hash (incl. the guide
        # sentinels) and the live key's ciphertext, so they must not be a
        # downloadable artifact of the preview site (red line 07 §8.5).
        if inside and DENY_BASENAME_RE.search(os.path.basename(target).lower()):
            return self._html(render_denied(path), code=403)
        if inside and os.path.isfile(target):
            # Reports are plain text and may quote crawled titles verbatim, so
            # they must never be served with an HTML content type.
            if target.endswith(".txt"):
                ctype = "text/plain; charset=utf-8"
            elif target.endswith(".xml"):
                ctype = "application/rss+xml; charset=utf-8"
            elif target.endswith((".html", ".htm")):
                ctype = "text/html; charset=utf-8"
            else:
                ctype = "application/octet-stream"
            with open(target, "rb") as fh:
                return self._send(200, fh.read(), ctype)
        if inside and os.path.isdir(target):
            names = sorted(os.listdir(target))
            return self._html(render_dir_listing(path, names))
        return self._html(render_404(path), code=404)


class _TagBalance(HTMLParser):
    """Collects unclosed / mismatched tags for the self-test."""

    VOID = frozenset({"meta", "link", "br", "img", "hr", "input", "source"})

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag not in self.VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        else:
            self.errors.append(tag)


def tag_balance_ok(doc: str) -> bool:
    parser = _TagBalance()
    parser.feed(doc)
    return not parser.errors and not parser.stack


def selftest() -> int:
    """Render every page and assert the invariants this module documents.

    Covers the red lines (07 §8.5), the render pipeline (tag balance, CSS
    variables), the queue detail renderer (no engine English left) and the
    token_keys field mapping.  Returns 0 when everything holds, 1 otherwise.
    No HTTP server is started.
    """
    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, bool(ok), detail))

    root_names = list_dir_names("/")
    pages = {
        "home": render_home(),
        "keys": render_keys(),
        "queue": render_queue(),
        "reports": render_dir_listing("/reports/", list_dir_names("/reports/")),
        "data-root": render_dir_listing("/", root_names),
        "404": render_404("/selftest"),
        "403": render_denied("/tokenhub.db"),
    }
    check("every page renders non-empty",
          all(len(doc) > 2000 for doc in pages.values()),
          ", ".join(f"{n}={len(d)}" for n, d in pages.items()))

    # ── red lines (07 §8.5) ──
    leaks = {n: len(PLAIN_KEY_RE.findall(doc)) for n, doc in pages.items()
             if PLAIN_KEY_RE.findall(doc)}
    check("no plaintext credential shape on any page", not leaks, str(leaks))
    forbidden = [w for w in ("key_encrypted", "key_hash", "error_message_raw")
                 if any(w in doc for doc in pages.values())]
    check("no red-line column name on any page", not forbidden, str(forbidden))

    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        row = conn.execute(
            "SELECT key_hash, key_encrypted, key_masked FROM token_keys"
            " WHERE source = 'post'").fetchone()
        conn.close()
    except sqlite3.Error as exc:                       # pragma: no cover - env issue
        check("database reachable read-only", False, repr(exc))
        row = None
    h, enc, masked = row if row else (None, None, None)
    if masked:
        check("live key_hash / ciphertext absent from every page",
              all(v not in doc for n, doc in pages.items() for v in (h, enc) if v))
        on_keys = [n for n, doc in pages.items() if masked in doc]
        check("masked key shown on /keys only", on_keys == ["keys"], str(on_keys))

    # ── render pipeline ──
    bad_tags = [n for n, doc in pages.items() if not tag_balance_ok(doc)]
    check("html tag balance", not bad_tags, str(bad_tags))
    css_ok = STYLE.count("{") == STYLE.count("}")
    declared = set(re.findall(r"(--[a-z0-9-]+)\s*:", STYLE))
    used = set(re.findall(r"var\((--[a-z0-9-]+)", STYLE))
    check("css braces balanced", css_ok, f"{STYLE.count('{')}/{STYLE.count('}')}")
    check("css variables all defined", not (used - declared), str(sorted(used - declared)))

    # ── queue detail renderer ──
    queue_body = pages["queue"]
    cells = re.findall(r"<td class='cell-detail'[^>]*>(.*?)</td>", queue_body, re.S)
    english = [c for c in cells if any(w in c for w in DETAIL_EN_STOPWORDS)]
    check("detail cells carry no engine English", not english,
          f"{len(english)}/{len(cells)} cells, e.g. {english[0][:120] if english else '-'}")
    proposals = [c for c in cells if "manual_queue" in c]
    check("detail cells hide the engine's re-file proposal", not proposals,
          f"{len(proposals)} cells")

    # ── field mapping against the live database ──
    rows = db_rows("SELECT * FROM token_keys WHERE deal_status = 'published'")
    missing = []
    for row in rows:
        name = display_name(row)
        if not name or name == "?":
            missing.append(f"name:{row.get('id')}")
        for label, value in (("title", row.get("source_title")),
                             ("url", row.get("source_url"))):
            if value and esc1(value) not in pages["keys"]:
                missing.append(f"{label}:{row.get('id')}")
        label = verdict_label(row.get("verdict"))[1]
        if label not in pages["keys"]:
            missing.append(f"verdict:{row.get('id')}")
    check(f"all {len(rows)} published rows rendered", not missing, str(missing[:5]))

    # confidence describes a (key, base_url) pair, so only non-guide rows carry one
    expect_conf = sum(1 for r in rows if r.get("source") != "reply_visible_guide")
    got_conf = len(re.findall(r"badge \w+'>置信", pages["keys"]))
    check("confidence badge count == rows with a credential",
          got_conf == expect_conf, f"{got_conf} badges / {expect_conf} rows")

    # ── refused files must not be offered as links ──
    denied_links = [name for name, doc in pages.items()
                    if any(DENY_BASENAME_RE.search(os.path.basename(href).lower())
                           for href in re.findall(r"href='([^']*)'", doc))]
    check("no page links a refused db file", not denied_links, str(denied_links))

    # ── static passthrough deny rule ──
    deny_cases = {"tokenhub.db": True, "tokenhub.db-wal": True, "tokenhub.db-shm": True,
                  "tokenhub.db.bak": True, "schema.sqlite3": True,
                  "index.html": False, "feed.xml": False, "alerts.log": False,
                  "reports/2026-01-01-0000.txt": False}
    wrong = [n for n, want in deny_cases.items()
             if bool(DENY_BASENAME_RE.search(n.lower())) != want]
    check("db deny rule matches exactly the database files", not wrong, str(wrong))

    failed = [c for c in checks if not c[1]]
    print(f"selftest: {len(checks) - len(failed)}/{len(checks)} checks passed"
          f"  (db={(len(pages))} documents, {len(rows)} token_rows, {len(cells)} queue cells)")
    for name, ok, detail in checks:
        print(f"  [{'ok' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail and not ok else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        raise SystemExit(selftest())
    print(f"serving http://{HOST}:{PORT}/ (read-only, local only)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
