#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""push_to_favshub.py — 爬虫库 → hao 站 F4 PAT 写通道（生产上报，docs/08 §4.3 / §9.4 方案 a）。

读取 crawler 库（sqlite URI mode=ro）中的 token_keys 行，逐行 ``POST /api/ai/token-keys``；
全部上报完成后按本轮快照对账清理（``POST /api/ai/token-keys/prune``）：站点上
``published`` 但不在本轮快照里的行被删除 —— 爬虫判 dead、guide 超 24h 或下架的行
在下一轮自动从站点消失（站点方 2026-10-08 需求：失效 key 及时清理）。

上报范围（2026-10-08 起）：
  * ``deal_status = 'published'`` 且 ``verdict != 'dead'``（dead 本地保留给状态机，
    不再上站 —— 站点不展示失效 key）；
  * 回帖指引行（reply_visible_guide）只带上报时刻 24h 内收录的（与爬虫 cleanup
    TTL 双保险）。

红线（docs/07 §8.5 / docs/08 §1.3 #3，脚本实现同样遵守）：
  * stdout 只输出计数与路径类信息 —— 绝不打印 key_hash / key_masked / key_encrypted
    / key_plain；
  * ``key_plain``：站点方拍板页面公开完整可复制 key（2026-10-08），故本脚本把
    ``key_encrypted`` 解密为明文随 HTTPS+PAT 通道上报（此前"密文原样搬运"纪律
    随之取消）；解密失败该行 key_plain 置空、照常上报脱敏行；
  * 源库只读打开（mode=ro），绝不写爬虫库；
  * PAT / FERNET_KEY 从 .env / 环境变量读取，不进日志、不进报告。

时间戳纪律：token_keys 沿爬虫语义存**秒**，站点侧同语义，原样透传（docs/08 §4.3）。

幂等：按 UNIQUE(key_hash, base_url) upsert + 幂等对账 prune，重复运行安全。
依赖：标准库 + cryptography（key_plain 解密）。

用法：
    python push_to_favshub.py --dry-run --limit 2   # 预演：只验证 2 行，不落库
    python push_to_favshub.py                       # 全量正式上报 + 对账清理
    python push_to_favshub.py --no-prune            # 只 upsert，不动站点存量
配置（process env > 同目录 .env > 默认值，与 crawler config.py 同序）：
    FAVSHUB_BASE_URL  站点地址，默认 https://hao.bx9y.com.cn
    FAVSHUB_PAT       favs_ai_ 明文令牌（管理员绑定，scope 需含 delete —— prune 用）
    FERNET_KEY        爬虫加密域密钥（key_plain 解密用）——必填
    DB_PATH           爬虫库路径，默认 crawler/data/tokenhub.db（相对脚本目录）
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional

# F4 verdict 白名单（8 值，与站点 index.get.ts VERDICTS / crawler verdict.py 同源）
VERDICTS = {
    "valid", "quota", "limited", "dead",
    "unknown", "restricted", "blocked_by_waf", "endpoint_unsupported",
}

# 源库 → F4 载荷的字段映射（docs/08 §4.3 契约 + 2026-10-08 增量：post_time 原帖时间、
# key_plain 明文（解密自 key_encrypted，见 decrypt_key_plain））。
# 注：key_encrypted 刻意不再上报 —— 站点侧只认明文 key_plain，密文不再过网。
FIELD_MAP = (
    "key_hash", "base_url", "key_masked", "provider", "models",
    "source", "confidence", "verdict", "source_id", "source_tid",
    "source_url", "source_title", "source_author",
    "consecutive_failures", "last_probe_at", "first_seen_at", "post_time", "note",
)

#: 只为解密而读、不上报的列
LOCAL_ONLY_COLUMNS = ("key_encrypted",)

#: 回帖指引行的收录窗口（秒）——与 crawler/store/db.py prune_expired_guide_rows 同值
GUIDE_WINDOW_SECONDS = 24 * 3600

#: 429 / 5xx 时最多重试次数（单行）；每次退避基数（秒）
RETRY_MAX, RETRY_BACKOFF = 2, 20


def load_env(path: Path) -> dict[str, str]:
    """极简 .env 解析：KEY=VALUE 行，# 注释，去引号；不打印任何值。"""
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip().strip("'\"")
        out.setdefault(key.strip(), val)
    return out


def cfg(name: str, default: str = "", env: dict[str, str] = None) -> str:
    if name in os.environ and os.environ[name]:
        return os.environ[name]
    if env and name in env and env[name]:
        return env[name]
    return default


def fetch_rows(db_path: str, limit: Optional[int]) -> tuple[list[dict], list[str]]:
    """只读打开爬虫库，取待上报行（published、非 dead、guide 限 24h）。

    返回 (rows, errors)。过滤与爬虫 cleanup 阶段的 TTL 删除双保险：即便爬虫库
    尚未跑过新 cleanup，本查询也不会把 dead / 过期 guide 行推上站点。
    """
    errors: list[str] = []
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        guide_cutoff = int(time.time()) - GUIDE_WINDOW_SECONDS
        sql = (
            "SELECT " + ", ".join(FIELD_MAP + LOCAL_ONLY_COLUMNS) +
            " FROM token_keys WHERE deal_status = 'published'"
            " AND verdict != 'dead'"
            " AND (source != 'reply_visible_guide' OR first_seen_at >= ?)"
            " ORDER BY last_probe_at DESC, first_seen_at DESC"
        )
        params: list[Any] = [guide_cutoff]
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = [dict(r) for r in conn.execute(sql, params)]
    finally:
        conn.close()
    return rows, errors


def decrypt_key_plain(key_encrypted: Optional[str], fernet_key: str) -> str:
    """解密 key_encrypted → 明文（站点公开可复制需求，2026-10-08）。

    任何失败（缺 key / 缺密文 / 密文损坏）都返回空串，绝不抛出、绝不打印内容。
    """
    if not key_encrypted or not fernet_key:
        return ""
    try:
        from cryptography.fernet import Fernet, InvalidToken  # 延迟导入，dry-run 轻启动
        token = Fernet(fernet_key.encode("utf-8")).decrypt(
            key_encrypted.encode("utf-8"))
        return token.decode("utf-8")
    except InvalidToken:
        return ""
    except Exception:
        return ""


def normalize(row: dict, plain: str = "") -> tuple[Optional[dict], str]:
    """F4 载荷归一化 + 白名单校验。返回 (payload, skip_reason)。

    ``plain`` 为解密后的 key 明文（可空 —— guide 行 / 解密失败行）；B 类行空明文
    时降级只报脱敏字段（与旧版行为一致）。LOCAL_ONLY_COLUMNS 不进载荷。
    """
    if not row.get("key_hash"):
        return None, "empty key_hash"
    verdict = row.get("verdict") or "unknown"
    if verdict not in VERDICTS:
        return None, f"verdict not in whitelist: {verdict}"
    body: dict[str, Any] = {}
    for col in FIELD_MAP:
        val = row.get(col)
        if val is None:
            continue
        body[col] = val
    if plain:
        body["key_plain"] = plain
    return body, ""


def post_json(base: str, pat: str, path: str, body: dict) -> tuple[int, dict]:
    """POST {base}{path}，带 429/网络退避重试。返回 (http_status, response_json)。"""
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    )
    last_err = None
    for attempt in range(1, RETRY_MAX + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:200]
            except Exception:
                pass
            if e.code == 429 and attempt < RETRY_MAX:
                time.sleep(RETRY_BACKOFF * attempt)
                continue
            raise RuntimeError(f"{path} HTTP {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            if attempt < RETRY_MAX:
                time.sleep(RETRY_BACKOFF * attempt)
                continue
            raise RuntimeError(f"network error: {type(e).__name__}") from e
    raise RuntimeError(f"network error: {type(last_err).__name__ if last_err else 'unknown'}")


def post_one(base: str, pat: str, body: dict, dry_run: bool) -> tuple[int, dict]:
    """单行 POST /api/ai/token-keys。返回 (http_status, response_json)。"""
    payload = dict(body)
    if dry_run:
        payload["dry_run"] = True
    return post_json(base, pat, "/api/ai/token-keys", payload)


def post_prune(base: str, pat: str, keep: list[dict]) -> tuple[int, dict]:
    """对账清理：站点删除 published 且不在 keep 身份列表里的行。

    keep 元素为 {"key_hash": ..., "base_url": ...}（哨兵 guide 行同样保留）。
    """
    return post_json(base, pat, "/api/ai/token-keys/prune", {"confirm": True, "keep": keep})


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="push crawler token_keys to favshub F4 endpoint")
    here = Path(__file__).resolve().parent
    ap.add_argument("--source", default=str(here / "crawler" / "data" / "tokenhub.db"),
                    help="爬虫 SQLite 库（只读）")
    ap.add_argument("--env", default=str(here / ".env"), help=".env 路径（默认脚本同目录）")
    ap.add_argument("--base", default=None, help="覆盖 FAVSHUB_BASE_URL")
    ap.add_argument("--pat", default=None, help="覆盖 FAVSHUB_PAT（其余来源：env > .env）")
    ap.add_argument("--limit", type=int, default=None, help="最多上报 N 行（试运行）")
    ap.add_argument("--dry-run", action="store_true", help="每行带 dry_run:true，不落库")
    ap.add_argument("--no-prune", action="store_true",
                    help="跳过对账清理（默认上报完成后删除站点上不在本轮快照的 published 行）")
    ap.add_argument("--json", action="store_true", help="结尾以 JSON 输出计数")
    args = ap.parse_args(argv)

    env = load_env(Path(args.env))
    base = args.base or cfg("FAVSHUB_BASE_URL", "https://hao.bx9y.com.cn", env)
    pat = args.pat or cfg("FAVSHUB_PAT", "", env)
    fernet_key = cfg("FERNET_KEY", "", env)
    db_path = args.source if os.path.isabs(args.source) else cfg("DB_PATH", args.source, env)
    if not pat:
        print("FATAL: FAVSHUB_PAT 未配置（env/.env 均无）", file=sys.stderr)
        return 2
    if not fernet_key:
        # key_plain 解密域密钥：缺失时 B 类行全部降级为脱敏行，视为配置错误早失败
        print("FATAL: FERNET_KEY 未配置（key_plain 解密需要）", file=sys.stderr)
        return 2
    if not Path(db_path).is_file():
        print(f"FATAL: 源库不存在: {db_path}", file=sys.stderr)
        return 2

    rows, _ = fetch_rows(db_path, args.limit)
    stats = {"scanned": len(rows), "sent": 0, "upserted": 0, "updated": 0,
             "skipped": 0, "dryrun": 0, "failed": 0, "pruned": 0}
    keep: list[dict] = []
    plain_failures = 0
    for row in rows:
        plain = decrypt_key_plain(row.get("key_encrypted"), fernet_key)
        if row.get("key_encrypted") and not plain:
            plain_failures += 1
        body, reason = normalize(row, plain)
        if body is None:
            stats["skipped"] += 1
            continue
        keep.append({"key_hash": body["key_hash"], "base_url": body.get("base_url", "")})
        try:
            status, resp = post_one(base, pat, body, args.dry_run)
        except RuntimeError as e:
            stats["failed"] += 1
            # 错误只带状态码与类型，绝不带行内容
            print(f"WARN: row push failed: {e}", file=sys.stderr)
            continue
        if status != 200:
            stats["failed"] += 1
            continue
        stats["sent"] += 1
        if args.dry_run:
            stats["dryrun"] += 1
        elif resp.get("upserted"):
            # F4 的 upserted=true 意为「本行 upsert 成功」，不区分插入/更新
            # （实测：同一批 61 行回放三轮，站点仍 61 行、0 重复）。
            stats["upserted"] += 1
        else:
            stats["updated"] += 1
        time.sleep(0.15)  # 温和节流（令牌限频 600/min，远低于上限）

    # 对账清理：只有全部行上报成功才执行 —— 带失败的对账可能误删「本轮恰好
    # 上报失败但站点仍应保留」的行。dry-run / --no-prune 跳过。
    if (not args.dry_run and not args.no_prune and not stats["failed"]
            and stats["sent"] > 0):
        try:
            pstatus, presp = post_prune(base, pat, keep)
            if pstatus == 200:
                stats["pruned"] = int(presp.get("deleted") or 0)
            else:
                stats["failed"] += 1
                print(f"WARN: prune skipped (HTTP {pstatus})", file=sys.stderr)
        except RuntimeError as e:
            stats["failed"] += 1
            print(f"WARN: prune failed: {e}", file=sys.stderr)
    if plain_failures:
        # 只报计数，不带任何行信息
        print(f"WARN: {plain_failures} row(s) failed key_plain decryption "
              "(pushed masked-only)", file=sys.stderr)

    if args.json:
        print(json.dumps(stats, ensure_ascii=False))
    else:
        print(f"scan={stats['scanned']} sent={stats['sent']} "
              f"new={stats['upserted']} updated={stats['updated']} "
              f"skipped={stats['skipped']} pruned={stats['pruned']} failed={stats['failed']}"
              + (" (dry-run)" if args.dry_run else ""))
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
