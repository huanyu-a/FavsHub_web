#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Nexus 评测数据同步 —— 把 new-api 的渠道清单与 eval_api 的每日评测结果
落进 FavsHub 库的 `nexus_channels` / `nexus_deal_map` 两张表，
供 /api/token-deals 做「已接入 Nexus 优先」排序。

在**服务器宿主**上执行（不是容器内）。容器内没有 sqlite3，
且 new-api 库与 eval_api 目录都不在容器挂载范围内。

用法：
    python3 sync-nexus.py --init-config     # 生成 nexus-sync.env（已存在则跳过）
    python3 sync-nexus.py --print-config    # 打印最终生效的配置与来源
    python3 sync-nexus.py --dry-run         # 只打印匹配结果，不写库
    python3 sync-nexus.py                   # 正式写入

配置优先级（高 → 低）：
    命令行参数 > 真实环境变量 > 同目录 nexus-sync.env > 内置默认
各项含义见 nexus-sync.env.example，或网站 README「Nexus 评测排序同步」一节。

cron 建议 08:30 触发（eval_api 每日 08:00 跑完后再同步）：
    30 8 * * * /usr/bin/python3 /path/to/scripts/nexus-sync/sync-nexus.py >> /var/log/nexus-sync.log 2>&1

匹配规则（deal → Nexus 渠道），按优先级：
    1. call_url 根域命中渠道 base_url 根域
    2. url 根域命中
    3. 人工别名表 PROVIDER_ALIASES（如 Google AI Studio → Gemini）
    4. 渠道名包含于 deal provider（归一化后，长度 ≥ 2）
own_domains 里的域永不匹配 —— 避免自家域名互相误匹配。
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(SCRIPT_DIR, 'nexus-sync.env')
EXAMPLE_FILE = os.path.join(SCRIPT_DIR, 'nexus-sync.env.example')

# ── 配置项 ────────────────────────────────────────────────────────────────
# 以下路径都指「服务器宿主」上的位置，不是容器内路径。
# 键名同时是环境变量名，便于 cron / systemd 直接覆盖。
DEFAULTS = {
    'NEWAPI_DB':   '/opt/app/new-api/data/one-api.db',   # new-api 的 SQLite 库
    'EVAL_DIR':    '/opt/app/eval_api',                  # 评测结果目录
    'FAVSHUB_DB':  '/opt/app/data/favshub.db',           # 本站 SQLite 库
    'OWN_DOMAINS': 'bx9y.com.cn',                        # 自有域，逗号分隔
    'EVAL_FILES':  'eval_latest.json,channel_eval_latest.json',
}
LIST_KEYS = ('OWN_DOMAINS', 'EVAL_FILES')

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


def parse_env_file(path: str) -> dict:
    """读取 KEY=VALUE 形式的配置文件，支持 # 注释与引号"""
    out = {}
    if not path or not os.path.exists(path):
        return out
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            lines = fh.readlines()
    except OSError as exc:
        raise SystemExit(f'[FATAL] 配置文件读取失败 {path}: {exc}')
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, val = line.split('=', 1)
        key = key.strip()
        if not key:
            continue
        out[key] = val.strip().strip('"').strip("'")
    return out


def resolve_config(cli_overrides: dict) -> tuple:
    """按 命令行 > 环境变量 > 配置文件 > 内置默认 解析，返回 (值, 来源)"""
    values = dict(DEFAULTS)
    sources = {k: '内置默认' for k in DEFAULTS}

    cfg_path = cli_overrides.get('config') or CONFIG_FILE
    for key, val in parse_env_file(cfg_path).items():
        if key in DEFAULTS:
            values[key] = val
            sources[key] = os.path.basename(cfg_path)

    for key in DEFAULTS:
        env_val = os.environ.get(key)
        if env_val not in (None, ''):
            values[key] = env_val
            sources[key] = '环境变量'

    for key in DEFAULTS:
        cli_val = cli_overrides.get(key)
        if cli_val not in (None, ''):
            values[key] = cli_val
            sources[key] = '命令行'

    return values, sources


def as_list(val) -> list:
    if isinstance(val, (list, tuple, set)):
        items = list(val)
    else:
        items = str(val).split(',')
    return [str(x).strip() for x in items if str(x).strip()]


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


def load_channels(newapi_db: str) -> list:
    if not os.path.exists(newapi_db):
        raise SystemExit(f'[FATAL] new-api 库不存在: {newapi_db}\n'
                         f'        请改 nexus-sync.env 里的 NEWAPI_DB，或用 --newapi-db 指定。')
    conn = sqlite3.connect(f'file:{newapi_db}?mode=ro', uri=True, timeout=15)
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


def load_eval(eval_dir: str, eval_files: list) -> tuple:
    """合并所有评测文件，按 channel_id 聚合出可用率与平均耗时"""
    agg = {}
    latest_ts = 0
    used_files = []
    for fname in eval_files:
        path = os.path.join(eval_dir, fname)
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


def load_deals(favshub_db: str) -> list:
    if not os.path.exists(favshub_db):
        raise SystemExit(f'[FATAL] FavsHub 库不存在: {favshub_db}\n'
                         f'        请改 nexus-sync.env 里的 FAVSHUB_DB，或用 --favshub-db 指定。')
    conn = sqlite3.connect(f'file:{favshub_db}?mode=ro', uri=True, timeout=15)
    try:
        rows = conn.execute(
            'SELECT id, provider, COALESCE(call_url, \'\'), COALESCE(url, \'\') FROM token_deals'
        ).fetchall()
    finally:
        conn.close()
    return [{'id': r[0], 'provider': r[1] or '', 'call_url': r[2], 'url': r[3]} for r in rows]


def match_deals(deals: list, channels: list, own_domains: set) -> list:
    """返回 [(deal_id, channel_id, matched_by), ...]"""
    by_domain = {}
    for ch in channels:
        if not ch['domain'] or ch['domain'] in own_domains:
            continue
        by_domain.setdefault(ch['domain'], ch['channel_id'])

    by_name = []
    for ch in channels:
        if ch['domain'] and ch['domain'] not in own_domains:
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
            if dom and dom in own_domains:
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


def cmd_init_config(dest: str) -> int:
    if os.path.exists(dest):
        print(f'[SKIP] 配置已存在：{dest}（如需重置请先删除）')
        return 0
    if not os.path.exists(EXAMPLE_FILE):
        print(f'[FATAL] 模板不存在：{EXAMPLE_FILE}', file=sys.stderr)
        return 1
    parent = os.path.dirname(os.path.abspath(dest))
    if parent and not os.path.isdir(parent):
        try:
            os.makedirs(parent, exist_ok=True)
        except OSError as exc:
            print(f'[FATAL] 无法创建目录 {parent}: {exc}', file=sys.stderr)
            return 1
    shutil.copyfile(EXAMPLE_FILE, dest)
    print(f'[OK] 已生成配置：{dest}')
    print('     请编辑其中的 NEWAPI_DB / EVAL_DIR / FAVSHUB_DB / OWN_DOMAINS 后重跑。')
    print('     改完可用 --print-config 确认最终生效值。')
    return 0


def cmd_print_config(values: dict, sources: dict, cfg_path: str) -> int:
    print(f'配置文件: {cfg_path}'
          f'{"（存在）" if os.path.exists(cfg_path) else "（不存在，使用内置默认）"}')
    print('-' * 78)
    for key in DEFAULTS:
        print(f'  {key:<11} = {values[key]:<48} [{sources[key]}]')
    print('-' * 78)
    print('优先级：命令行参数 > 环境变量 > 配置文件 > 内置默认')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description='Nexus 评测数据同步（配置优先级：命令行 > 环境变量 > nexus-sync.env > 内置默认）')
    ap.add_argument('--config', help=f'配置文件路径（默认 {CONFIG_FILE}）')
    ap.add_argument('--init-config', action='store_true',
                    help='生成 nexus-sync.env 配置模板后退出')
    ap.add_argument('--print-config', action='store_true',
                    help='打印最终生效的配置与来源后退出')
    ap.add_argument('--newapi-db', help='new-api 的 SQLite 库路径')
    ap.add_argument('--eval-dir', help='评测结果目录')
    ap.add_argument('--favshub-db', help='本站 SQLite 库路径')
    ap.add_argument('--own-domains', help='自有域，逗号分隔')
    ap.add_argument('--eval-files', help='参与聚合的评测文件名，逗号分隔')
    ap.add_argument('--dry-run', action='store_true', help='只打印匹配结果，不写库')
    args = ap.parse_args()

    cfg_path = args.config or CONFIG_FILE

    if args.init_config:
        return cmd_init_config(cfg_path)

    # argparse 的 dest 是小写下划线（eval_dir），而配置键是大写（EVAL_DIR）——
    # 这里显式映射，避免命令行覆盖因键名不匹配而静默失效。
    cli_overrides = {
        'config': args.config,
        'NEWAPI_DB': args.newapi_db,
        'EVAL_DIR': args.eval_dir,
        'FAVSHUB_DB': args.favshub_db,
        'OWN_DOMAINS': args.own_domains,
        'EVAL_FILES': args.eval_files,
    }
    values, sources = resolve_config(cli_overrides)

    if args.print_config:
        return cmd_print_config(values, sources, cfg_path)

    newapi_db = values['NEWAPI_DB']
    eval_dir = values['EVAL_DIR']
    favshub_db = values['FAVSHUB_DB']
    own_domains = set(as_list(values['OWN_DOMAINS']))
    eval_files = as_list(values['EVAL_FILES'])

    channels = load_channels(newapi_db)
    if len(channels) < 5:
        print(f'[FATAL] 渠道数异常（{len(channels)}），中止以免清空已有数据', file=sys.stderr)
        return 1

    stats, eval_ts, used_files = load_eval(eval_dir, eval_files)
    deals = load_deals(favshub_db)
    matches = match_deals(deals, channels, own_domains)

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

    conn = sqlite3.connect(favshub_db, timeout=15)
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
