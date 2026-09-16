#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nexus 评测数据同步 —— 把 new-api 的渠道清单与 eval_api 的每日评测结果
落进 FavsHub 库的 `nexus_channels` / `nexus_deal_map` 两张表，
供 /api/token-deals 做「已接入 Nexus 优先」排序。

在**服务器宿主**上执行（不是容器内）。容器内没有 sqlite3，
且 new-api 库与 eval_api 目录都不在容器挂载范围内。

用法：
    python3 sync-nexus.py              # 写入
    python3 sync-nexus.py --dry-run    # 只打印匹配结果，不写库

cron 建议 08:30 触发（eval_api 每日 08:00 跑完后再同步）：
    30 8 * * * /usr/bin/python3 /opt/app/nexus_sync/sync-nexus.py >> /var/log/nexus-sync.log 2>&1

匹配规则（deal → Nexus 渠道），按优先级：
    1. call_url 根域命中渠道 base_url 根域
    2. url 根域命中
    3. 人工别名表 PROVIDER_ALIASES（如 Google AI Studio → Gemini）
    4. 渠道名包含于 deal provider（归一化后，长度 ≥ 2）
自有域（OWN_DOMAINS）永不匹配 —— 避免「星枢 Nexus」被匹配到自家 WorkBuddy 渠道。
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

# ── 路径（可用环境变量覆盖）──────────────────────────────────────────────
NEWAPI_DB = os.environ.get('NEWAPI_DB', '/opt/app/new-api/data/one-api.db')
EVAL_DIR = os.environ.get('EVAL_DIR', '/opt/app/eval_api')
FAVSHUB_DB = os.environ.get('FAVSHUB_DB', '/opt/app/data/favshub.db')

# 参与聚合的评测文件（按顺序合并；同一渠道的多次探测累加）
EVAL_FILES = ['eval_latest.json', 'channel_eval_latest.json']

# 自有域：命中即跳过，防止自家域名（nexus.bx9y.com.cn / wbm.bx9y.com.cn）互相误匹配
OWN_DOMAINS = {'bx9y.com.cn'}

# 人工别名：归一化后的 deal provider → Nexus channel_id
# Gemini 是 new-api 内置渠道（type=24），没有 base_url，只能靠别名
PROVIDER_ALIASES = {
    'googleaistudio': 11,   # Google AI Studio → Gemini
}

# 二级后缀，用于取「可注册根域」
MULTI_SUFFIX = {
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
    'com.hk', 'org.hk', 'com.tw', 'co.jp', 'co.uk', 'com.au', 'com.sg',
}


def root_domain(host: str) -> str:
    """取可注册根域：api.agnes-ai.cn → agnes-ai.cn；developer.amd.com.cn → amd.com.cn"""
    if not host:
        return ''
    host = host.split(':')[0].strip().lower().rstrip('.')
    if host.startswith('www.'):
        host = host[4:]
    parts = [p for p in host.split('.') if p]
    if len(parts) < 2:
        return host
    if len(parts) >= 3 and '.'.join(parts[-2:]) in MULTI_SUFFIX:
        return '.'.join(parts[-3:])
    return '.'.join(parts[-2:])


def host_of(url: str) -> str:
    if not url:
        return ''
    raw = url if '://' in url else 'http://' + url
    try:
        return (urlparse(raw).hostname or '').lower()
    except Exception:
        return ''


def norm_name(s: str) -> str:
    """归一化名称：去空白（含全角）、转小写"""
    if not s:
        return ''
    return re.sub(r'[\s\u3000\u00a0]+', '', s).lower()


def load_channels() -> list:
    if not os.path.exists(NEWAPI_DB):
        raise SystemExit(f'[FATAL] new-api 库不存在: {NEWAPI_DB}')
    conn = sqlite3.connect(f'file:{NEWAPI_DB}?mode=ro', uri=True, timeout=15)
    try:
        rows = conn.execute(
            'SELECT id, name, COALESCE(base_url, \'\'), type, status FROM channels ORDER BY id'
        ).fetchall()
    finally:
        conn.close()
    out = []
    for cid, name, base_url, ctype, status in rows:
        host = host_of(base_url)
        out.append({
            'channel_id': int(cid),
            'name': name or '',
            'base_url': base_url or '',
            'domain': root_domain(host),
            'type': int(ctype or 0),
            'status': int(status or 0),
        })
    return out


def load_eval() -> tuple:
    """合并所有评测文件，按 channel_id 聚合出可用率与平均耗时"""
    agg = {}
    latest_ts = 0
    used_files = []
    for fname in EVAL_FILES:
        path = os.path.join(EVAL_DIR, fname)
        if not os.path.exists(path):
            continue
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                data = json.load(fh)
        except Exception as exc:
            print(f'[WARN] 读取 {fname} 失败: {exc}', file=sys.stderr)
            continue
        used_files.append(fname)

        ts_raw = str(data.get('timestamp') or '')
        ts = 0
        for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S'):
            try:
                ts = int(datetime.strptime(ts_raw[:19], fmt)
                         .replace(tzinfo=timezone.utc).timestamp())
                break
            except Exception:
                continue
        latest_ts = max(latest_ts, ts)

        for item in data.get('results') or []:
            try:
                cid = int(item.get('channel_id'))
            except (TypeError, ValueError):
                continue
            slot = agg.setdefault(cid, {'ok': 0, 'total': 0, 'ms_sum': 0, 'ms_n': 0})
            slot['total'] += 1
            ok = bool(item.get('ok'))
            if ok:
                slot['ok'] += 1
                try:
                    sec = float(item.get('time_s') or 0)
                except (TypeError, ValueError):
                    sec = 0
                if sec > 0:
                    slot['ms_sum'] += sec * 1000
                    slot['ms_n'] += 1

    stats = {}
    for cid, slot in agg.items():
        stats[cid] = {
            'eval_ok': slot['ok'],
            'eval_total': slot['total'],
            'eval_avg_ms': int(round(slot['ms_sum'] / slot['ms_n'])) if slot['ms_n'] else 0,
        }
    return stats, latest_ts, used_files


def load_deals() -> list:
    if not os.path.exists(FAVSHUB_DB):
        raise SystemExit(f'[FATAL] FavsHub 库不存在: {FAVSHUB_DB}')
    conn = sqlite3.connect(f'file:{FAVSHUB_DB}?mode=ro', uri=True, timeout=15)
    try:
        rows = conn.execute(
            'SELECT id, provider, COALESCE(call_url, \'\'), COALESCE(url, \'\') FROM token_deals'
        ).fetchall()
    finally:
        conn.close()
    return [{'id': r[0], 'provider': r[1] or '', 'call_url': r[2], 'url': r[3]} for r in rows]


def match_deals(deals: list, channels: list) -> list:
    """返回 [(deal_id, channel_id, matched_by), ...]"""
    by_domain = {}
    for ch in channels:
        if not ch['domain'] or ch['domain'] in OWN_DOMAINS:
            continue
        by_domain.setdefault(ch['domain'], ch['channel_id'])

    by_name = []
    for ch in channels:
        if ch['domain'] and ch['domain'] not in OWN_DOMAINS:
            # 有域名的渠道已由域名规则覆盖，名称规则只用于无 base_url 的渠道
            continue
        n = norm_name(ch['name'])
        if len(n) >= 2:
            by_name.append((n, ch['channel_id']))

    results = []
    for deal in deals:
        cid, how = None, ''

        for field in ('call_url', 'url'):
            dom = root_domain(host_of(deal[field]))
            if dom and dom in OWN_DOMAINS:
                break
            if dom and dom in by_domain:
                cid, how = by_domain[dom], f'domain:{dom}'
                break
        if cid is None:
            alias = PROVIDER_ALIASES.get(norm_name(deal['provider']))
            if alias is not None:
                cid, how = alias, 'alias'
        if cid is None:
            prov = norm_name(deal['provider'])
            if prov:
                for n, ch_id in by_name:
                    if n in prov:
                        cid, how = ch_id, f'name:{n}'
                        break

        if cid is not None:
            results.append((deal['id'], cid, how))
    return results


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='只打印匹配结果，不写库')
    args = ap.parse_args()

    channels = load_channels()
    if len(channels) < 5:
        print(f'[FATAL] 渠道数异常（{len(channels)}），中止以免清空已有数据', file=sys.stderr)
        return 1

    stats, eval_ts, used_files = load_eval()
    deals = load_deals()
    matches = match_deals(deals, channels)

    name_of = {c['channel_id']: c['name'] for c in channels}
    deal_of = {d['id']: d['provider'] for d in deals}

    matched_ids = {m[1] for m in matches}
    print(f'渠道 {len(channels)} 个 | 通告 {len(deals)} 条 | 命中 {len(matches)} 条 '
          f'| 覆盖渠道 {len(matched_ids)} 个')
    print(f'评测文件: {", ".join(used_files) or "（无）"} | 评测时间戳: {eval_ts}')
    print('-' * 78)
    for deal_id, cid, how in sorted(matches, key=lambda x: x[1]):
        st = stats.get(cid, {})
        rate = f"{st.get('eval_ok', 0)}/{st.get('eval_total', 0)}"
        ms = st.get('eval_avg_ms', 0)
        enabled = next((c['status'] == 1 for c in channels if c['channel_id'] == cid), False)
        print(f'  #{cid:<3} {name_of.get(cid, ""):<20} ← {deal_of.get(deal_id, "")[:24]:<26} '
              f'[{how}] {"启用" if enabled else "禁用"} {rate} {ms}ms')
    print('-' * 78)

    if args.dry_run:
        print('[DRY-RUN] 未写入数据库')
        return 0

    now = int(time.time())
    ch_rows = []
    for ch in channels:
        st = stats.get(ch['channel_id'], {})
        ch_rows.append((
            ch['channel_id'], ch['name'], ch['base_url'], ch['domain'],
            ch['type'], ch['status'],
            st.get('eval_ok', 0), st.get('eval_total', 0),
            st.get('eval_avg_ms', 0), eval_ts, now,
        ))
    map_rows = [(deal_id, cid, how, now) for deal_id, cid, how in matches]

    conn = sqlite3.connect(FAVSHUB_DB, timeout=15)
    try:
        conn.execute('PRAGMA busy_timeout = 15000')
        with conn:  # 事务：任一步失败整体回滚，不会留下半截数据
            conn.execute('DELETE FROM nexus_deal_map')
            conn.execute('DELETE FROM nexus_channels')
            conn.executemany(
                'INSERT INTO nexus_channels '
                '(channel_id, name, base_url, domain, type, status, '
                ' eval_ok, eval_total, eval_avg_ms, eval_at, synced_at) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?)', ch_rows)
            conn.executemany(
                'INSERT INTO nexus_deal_map (deal_id, channel_id, matched_by, synced_at) '
                'VALUES (?,?,?,?)', map_rows)
    finally:
        conn.close()

    print(f'[OK] 已写入 nexus_channels {len(ch_rows)} 行 / nexus_deal_map {len(map_rows)} 行')
    return 0


if __name__ == '__main__':
    sys.exit(main())
