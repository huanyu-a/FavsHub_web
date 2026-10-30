#!/usr/bin/env bash
# 构建互斥锁：多个 teammate 共用同一个工作区，而 nuxt build 会写共享的 .nuxt/.output，
# 并发构建会互相破坏。所有构建必须走这里串行化。
#   用法：bash scripts/with-build-lock.sh            → 跑 pnpm build
#         bash scripts/with-build-lock.sh -- <cmd>   → 跑指定命令
set -euo pipefail
LOCK=/tmp/favshub-build.lock
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--" ]; then shift; CMD=("$@"); else CMD=(pnpm build); fi
echo "[build-lock] 等待锁（当前使用者可能正在构建，最多等 20 分钟）…"
exec 9>"$LOCK"
flock -w 1200 9
echo "[build-lock] 已获取锁：${CMD[*]}"
"${CMD[@]}"
