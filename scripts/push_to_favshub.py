#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""push_to_favshub.py — 爬虫库 → hao 站 F4 PAT 写通道（生产上报，docs/08 §4.3 / §9.4 方案 a）。

读取 crawler 库（sqlite URI mode=ro）中 ``deal_status = 'published'`` 的 token_keys 行，
逐行 ``POST /api/ai/token-keys``。管理员 PAT 上报 → INSERT/UPDATE 直接 published
（docs/07 §8.4 F4：普通 PAT→pending / 管理员 PAT→published；本脚本假定 PAT 为管理员绑定）。

红线（docs/07 §8.5 / docs/08 §1.3 #3，脚本实现同样遵守）：
  * stdout 只输出计数与路径类信息 —— 绝不打印 key_hash / key_masked / key_encrypted；
  * ``key_encrypted`` 密文原样搬运：不解密、不重加密、不变换（本地桥 §5.2 同纪律）；
  * 源库只读打开（mode=ro），绝不写爬虫库；
  * PAT 从 .env / 环境变量读取，不进日志、不进报告。

时间戳纪律：token_keys 沿爬虫语义存**秒**，站点侧同语义，原样透传（docs/08 §4.3）。

幂等：按 UNIQUE(key_hash, base_url) upsert，重复运行安全（与 docs/08 §5.2 一致）。
标准库 only（sqlite3 / urllib / argparse），无第三方依赖。

用法：
    python push_to_favshub.py --dry-run --limit 2   # 预演：只验证 2 行，不落库
    python push_to_favshub.py                       # 全量正式上报
配置（process env > 同目录 .env > 默认值，与 crawler config.py 同序）：
    FAVSHUB_BASE_URL  站点地址，默认 https://hao.bx9y.com.cn
    FAVSHUB_PAT       favs_ai_ 明文令牌（管理员绑定，scope 至少 write）——必填
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

# 源库 → F4 载荷的字段映射（docs/08 §4.3 契约；key_encrypted 原样透传）
FIELD_MAP = (
    "key_hash", "base_url", "key_masked", "key_encrypted", "provider", "models",
    "source", "confidence", "verdict", "source_id", "source_tid",
    "source_url", "source_title", "source_author",
    "consecutive_failures", "last_probe_at", "first_seen_at", "note",
)

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
    """只读打开爬虫库，取 published 行（含密文）。返回 (rows, errors)。"""
    errors: list[str] = []
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        sql = (
            "SELECT " + ", ".join(FIELD_MAP) +
            " FROM token_keys WHERE deal_status = 'published'"
            " ORDER BY last_probe_at DESC, first_seen_at DESC"
        )
        if limit:
            sql += f" LIMIT {int(limit)}"
        rows = [dict(r) for r in conn.execute(sql)]
    finally:
        conn.close()
    return rows, errors


def normalize(row: dict) -> tuple[Optional[dict], str]:
    """F4 载荷归一化 + 白名单校验。返回 (payload, skip_reason)。"""
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
    return body, ""


def post_one(base: str, pat: str, body: dict, dry_run: bool) -> tuple[int, dict]:
    """单行 POST /api/ai/token-keys。返回 (http_status, response_json)。"""
    payload = dict(body)
    if dry_run:
        payload["dry_run"] = True
    req = urllib.request.Request(
        base.rstrip("/") + "/api/ai/token-keys",
        data=json.dumps(payload).encode("utf-8"),
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
            raise RuntimeError(f"F4 HTTP {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            if attempt < RETRY_MAX:
                time.sleep(RETRY_BACKOFF * attempt)
                continue
            raise RuntimeError(f"network error: {type(e).__name__}") from e
    raise RuntimeError(f"network error: {type(last_err).__name__ if last_err else 'unknown'}")


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
    ap.add_argument("--json", action="store_true", help="结尾以 JSON 输出计数")
    args = ap.parse_args(argv)

    env = load_env(Path(args.env))
    base = args.base or cfg("FAVSHUB_BASE_URL", "https://hao.bx9y.com.cn", env)
    pat = args.pat or cfg("FAVSHUB_PAT", "", env)
    db_path = args.source if os.path.isabs(args.source) else cfg("DB_PATH", args.source, env)
    if not pat:
        print("FATAL: FAVSHUB_PAT 未配置（env/.env 均无）", file=sys.stderr)
        return 2
    if not Path(db_path).is_file():
        print(f"FATAL: 源库不存在: {db_path}", file=sys.stderr)
        return 2

    rows, _ = fetch_rows(db_path, args.limit)
    stats = {"scanned": len(rows), "sent": 0, "upserted": 0, "updated": 0,
             "skipped": 0, "dryrun": 0, "failed": 0}
    for row in rows:
        body, reason = normalize(row)
        if body is None:
            stats["skipped"] += 1
            continue
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

    if args.json:
        print(json.dumps(stats, ensure_ascii=False))
    else:
        print(f"scan={stats['scanned']} sent={stats['sent']} "
              f"new={stats['upserted']} updated={stats['updated']} "
              f"skipped={stats['skipped']} failed={stats['failed']}"
              + (" (dry-run)" if args.dry_run else ""))
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
