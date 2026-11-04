#!/usr/bin/env bash
#
# verify-edge-ip-integrity.sh — 校验「边缘链路是否保住了客户端真实 IP」
#
# ⚠️ 这个脚本在**服务器上**跑（需要 docker + iptables），不在 CI 里跑 ——
#    CI 没有这台宿主机，检查的对象是**部署事实**而不是应用代码。
#
# ## 为什么需要它
#
# 全站的「一人一票 / 按 IP 限频 / 游客去重」都建立在**客户端 IP 可信**之上：
#   - `getClientIP()`（server/utils/rate-limit.ts）在 peer 是内网时**直接采信
#     `X-Real-IP`` —— 因为链路最后一跳是我们自己的 nginx，它用 `$remote_addr` 覆盖该头；
#   - `$remote_addr` 又由 nginx 的 realip 模块从 `X-Forwarded-For` **从右往左**取
#     第一个「非可信代理」地址算出。
#
# 于是正确性依赖**两个部署事实**，缺一即失守：
#
#   ① nginx 必须用 `$remote_addr` **覆盖** `X-Real-IP`（若改成透传客户端的值，
#      或删掉这行 `proxy_set_header`，应用就会采信伪造值）；
#   ② 容器映射出去的 3090 **绝不能对外可达** —— 对外直连时链路里没有宝塔 nginx
#      追加真实 IP，此时 realip 会把客户端伪造的 `X-Forwarded-For` 当成真实 IP。
#
# 实测过（2026-11-05）：
#   - 直连 127.0.0.1:3090 + `X-Forwarded-For: 203.0.113.77` → nginx 日志里
#     `$remote_addr` **就是 203.0.113.77**（伪造被采信）；
#   - 经公网 HTTPS 同款伪造 → 日志里 `$remote_addr` 是真实 IP，伪造被顶掉。
# 也就是说：②一旦失守，①的保护形同虚设 —— IP 可任意伪造，按 IP 的配额全部失效。
#
# 这两条此前**没有任何检查**（CI 不覆盖部署事实，改坏了没人知道）。本脚本把它们
# 变成可随时复验的断言。
#
# ## 用法
#
#   bash scripts/verify-edge-ip-integrity.sh [公网 URL]
#   # 例：bash scripts/verify-edge-ip-integrity.sh https://hao.bx9y.com.cn
#
# 退出码非 0 = 有断言失败，请按提示修复后再上线。
#
set -uo pipefail

PUBLIC_URL="${1:-https://hao.bx9y.com.cn}"
NGINX_CONTAINER="${NGINX_CONTAINER:-}"
APP_CONTAINER="${APP_CONTAINER:-}"
EDGE_PORT="${EDGE_PORT:-3090}"
APP_PORT="${APP_PORT:-3000}"

pass=0
fails=0
ok()   { pass=$((pass+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { fails=$((fails+1)); printf '  \033[31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
note() { printf '  \033[90m·\033[0m %s\n' "$1"; }
section() { printf '\n▶ %s\n' "$1"; }

have() { command -v "$1" >/dev/null 2>&1; }

if ! have docker; then
  echo "未找到 docker —— 本脚本必须在部署这台站点的宿主机上运行。" >&2
  exit 2
fi

# ── 自动发现容器（可用环境变量覆盖）────────────────────────────────
# 边缘容器：优先「把 EDGE_PORT 映射出去的那个」（按端口反查比猜名字可靠），
# 再退回名字里带 nginx 的。
if [ -z "$NGINX_CONTAINER" ]; then
  NGINX_CONTAINER=$(docker ps --format '{{.Names}}\t{{.Ports}}' | awk -v p=":${EDGE_PORT}->" 'index($0,p){print $1}' | head -1 || true)
fi
if [ -z "$NGINX_CONTAINER" ]; then
  NGINX_CONTAINER=$(docker ps --format '{{.Names}}' | grep -E 'nginx' | head -1 || true)
fi

# 先读边缘配置 —— 下面的站点容器识别要靠它回源的 host
NGINX_CONF=""
if [ -n "$NGINX_CONTAINER" ]; then
  # tr -d '\r'：生产 nginx.conf 是 **CRLF** 行尾。不剥掉的话 `$NF` 是 "{\r" 而不是 "{"，
  # location 名会被解析成裸回车 —— 不报错、但分类全错（踩过一次）。
  NGINX_CONF=$(docker exec "$NGINX_CONTAINER" sh -c 'cat /etc/nginx/conf.d/*.conf 2>/dev/null' | tr -d '\r' || true)
fi

# 站点容器：取 nginx 回源的那个 host，按 docker **网络别名**精确匹配。
# 不靠猜名字 —— 之前按名字猜，把 nginx 自己当成了站点容器，
# 于是「站点容器把端口发布到了宿主机」这条报的是 nginx 自己的端口。
if [ -z "$APP_CONTAINER" ] && [ -n "$NGINX_CONF" ]; then
  APP_HOST=$(printf '%s\n' "$NGINX_CONF" \
    | grep -oE "proxy_pass[[:space:]]+http://[^:/;]+:${APP_PORT}" | head -1 | sed -E 's|.*//||; s|:.*||' || true)
  if [ -n "$APP_HOST" ]; then
    for c in $(docker ps --format '{{.Names}}'); do
      aliases=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$v.Aliases}} {{end}}' "$c" 2>/dev/null || true)
      case " $aliases " in *" $APP_HOST "*) APP_CONTAINER="$c"; break;; esac
    done
  fi
fi


if [ -z "$NGINX_CONF" ]; then
  bad "读不到 nginx 配置" "容器名不对？用 NGINX_CONTAINER=xxx 指定"
else
  # 逐个 location 看：回源应用的有没有覆盖 X-Real-IP。
  #
  # 为什么**只对承载 /api 的 location** 强制要求：
  # 全站限流中间件第一行就是「非 /api 一律 return」（server/middleware/rate-limit.ts），
  # 按 IP 的配额与身份判定只发生在 /api 路径上。纯静态路径（/favicon.ico 等）不设
  # X-Real-IP 时，应用只会看到 nginx 的地址 —— 但那些路径既不限频也不认身份，无害。
  # 实测本机配置：11 处回源里有 3 处（favicon.ico / favicon.png / apple-touch-icon.png）
  # 只传 Host，正属于这一类。
  #
  # 反过来，`location /`（catch-all，/api 走的就是它）若漏了这行，就是**真失守**：
  # 应用会采信客户端自己塞的 X-Real-IP。
  awk -v app_port="$APP_PORT" '
    /^[[:space:]]*location[[:space:]]/ { loc=$(NF-1); gsub(/[={]/,"",loc); set_realip=0; has_proxy=0; next }
    $0 ~ ("proxy_pass[[:space:]]+http://[^;]*:" app_port) { has_proxy=1 }
    $0 ~ /proxy_set_header[[:space:]]+X-Real-IP[[:space:]]+\$remote_addr/ { set_realip=1 }
    /^[[:space:]]*}/ { if (has_proxy) print loc "\t" set_realip; has_proxy=0 }
  ' <<< "$NGINX_CONF" > /tmp/_edge_locs.$$
  loc_total=$(wc -l < /tmp/_edge_locs.$$ | tr -d ' ')
  loc_covered=$(awk -F'\t' '$2==1' /tmp/_edge_locs.$$ | wc -l | tr -d ' ')

  if [ "$loc_total" -eq 0 ]; then
    bad "配置里没有任何回源到应用（:$APP_PORT）的 location" "检查 APP_PORT 是否写对"
  else
    note "回源应用的 location: $loc_total 处；覆盖 X-Real-IP 的: $loc_covered 处"
    # /api 只能落在 catch-all `location /` 或显式 /api 前缀的 location 上
    api_bad=$(awk -F'\t' '$2==0 && ($1=="/" || $1 ~ /^\/api/) {printf "%s ", $1}' /tmp/_edge_locs.$$ || true)
    if [ -z "$api_bad" ]; then
      ok "所有承载 /api 的 location 都用 \$remote_addr 覆盖了 X-Real-IP"
      missed=$(awk -F'\t' '$2==0 {printf "%s ", $1}' /tmp/_edge_locs.$$ || true)
      [ -n "$missed" ] && note "未设 X-Real-IP 的是纯静态路径：$missed（不进限流中间件，无害）"
    else
      bad "有承载 /api 的 location 没有覆盖 X-Real-IP" \
          "受影响：$api_bad。该路径上应用会采信客户端自己塞的 X-Real-IP → 按 IP 的配额失效"
    fi
  fi
  rm -f /tmp/_edge_locs.$$

  # realip 三件套：可信段 + 头来源 + 递归
  printf '%s\n' "$NGINX_CONF" | grep -qE '^\s*set_real_ip_from\s+' \
    && ok "已声明 set_real_ip_from（可信代理段）" \
    || bad "缺少 set_real_ip_from" "未声明可信代理段时 realip 不生效，\$remote_addr 恒为直连地址"
  printf '%s\n' "$NGINX_CONF" | grep -qE '^\s*real_ip_header\s+X-Forwarded-For\s*;' \
    && ok "real_ip_header 为 X-Forwarded-For" \
    || bad "real_ip_header 不是 X-Forwarded-For" "宝塔把真实 IP 追加在 XFF 末尾，换别的头会让取自右侧的逻辑失效"
  printf '%s\n' "$NGINX_CONF" | grep -qE '^\s*real_ip_recursive\s+on\s*;' \
    && ok "real_ip_recursive on（从右往左取非可信地址）" \
    || bad "real_ip_recursive 不是 on" "关掉后 nginx 取 XFF 最左侧，客户端伪造的第一段就会被采信"

  # 危险形态：把客户端的头原样透传下去
  if printf '%s\n' "$NGINX_CONF" | grep -qE 'proxy_set_header\s+X-Real-IP\s+\$http_x_real_ip'; then
    bad "发现 X-Real-IP 透传客户端值（\\\$http_x_real_ip）" "这是最危险的写法：客户端可任意指定自己的 IP"
  fi
fi

# ══════════════════════════════════════════════════════════════════
section "② 边缘端口绝不能对外可达（否则 realip 会被伪造顶掉）"
# ══════════════════════════════════════════════════════════════════
if have iptables; then
  # 找「从公网网卡进来、原始目的端口是 EDGE_PORT」的 DROP
  drop_rule=$(iptables-save 2>/dev/null | grep -E -- "-A DOCKER-USER .*--ctorigdstport ${EDGE_PORT} .*-j DROP" || true)
  if [ -n "$drop_rule" ]; then
    ok "DOCKER-USER 里有丢弃公网→$EDGE_PORT 的规则"
    note "$(printf '%s' "$drop_rule" | sed 's/^-A //' | cut -c1-110)"
  else
    bad "未发现丢弃「公网网卡 → $EDGE_PORT」的规则" \
        "对外直连 $EDGE_PORT 时链路里没有宝塔追加真实 IP，realip 会把客户端伪造的 X-Forwarded-For 当成真实 IP —— 实测过，届时 IP 可任意伪造"
  fi
else
  note "无 iptables，跳过（若不是 Linux 宿主机属正常）"
fi

# 应用端口不应发布到宿主机
if have docker && [ -n "$APP_CONTAINER" ]; then
  published=$(docker port "$APP_CONTAINER" 2>/dev/null || true)
  if [ -z "$published" ]; then
    ok "站点容器未把应用端口发布到宿主机（只在容器网络内可达）"
  else
    bad "站点容器把端口发布到了宿主机" "$published"
  fi
fi

# ══════════════════════════════════════════════════════════════════
section "③ 行为验证：本地直连可被伪造 / 公网链路不可被伪造"
# ══════════════════════════════════════════════════════════════════
# ③-a 本地直连 —— 这一步**预期就是「伪造被采信」**。
#     它的意义不是「发现了漏洞」，而是**证明 ② 的防护是必要的**：
#     一旦 3090 对外暴露，伪造马上就能生效。
if have docker && [ -n "$NGINX_CONTAINER" ] && have curl; then
  FORGED_A="203.0.113.77"
  probe_a="edgeip_local_$$"
  curl -s -o /dev/null -m 10 -H "X-Forwarded-For: $FORGED_A" \
    "http://127.0.0.1:${EDGE_PORT}/api/announcements?probe=${probe_a}" 2>/dev/null || true
  sleep 1
  logged_a=$(docker logs "$NGINX_CONTAINER" --tail 60 2>&1 | grep "probe=${probe_a}" | head -1 || true)
  if [ -z "$logged_a" ]; then
    note "本地直连探针未出现在日志里（合规的本地部署可能如此），跳过本项"
  elif printf '%s' "$logged_a" | grep -q "^${FORGED_A} "; then
    ok "本地直连时伪造的 XFF 被采信 —— 证实「对外暴露即失守」，故 ② 的防火墙规则是必需项"
  else
    bad "本地直连时伪造未被采信（异常）" "realip 可能没生效？检查 set_real_ip_from 是否包含 127.0.0.1"
  fi
fi

# ③-b 公网链路 —— 这一步是**真正的安全断言**：伪造必须被真实 IP 顶掉。
if have docker && [ -n "$NGINX_CONTAINER" ] && have curl; then
  FORGED_B="198.51.100.9"
  probe_b="edgeip_public_$$"
  curl -s -o /dev/null -m 15 -H "X-Forwarded-For: $FORGED_B" \
    "${PUBLIC_URL%/}/api/announcements?probe=${probe_b}" 2>/dev/null || true
  sleep 1
  logged_b=$(docker logs "$NGINX_CONTAINER" --tail 60 2>&1 | grep "probe=${probe_b}" | head -1 || true)
  if [ -z "$logged_b" ]; then
    note "公网探针未出现在本容器日志里 —— 该 URL 可能没走这条链路，本项无法判定（不算失败）"
  else
    seen_ip=$(printf '%s' "$logged_b" | awk '{print $1}')
    if [ "$seen_ip" = "$FORGED_B" ]; then
      bad "公网链路上伪造的 X-Forwarded-For 被当成了真实 IP！" \
          "此时任何人都能伪造 IP，按 IP 的限频与「一人一票」全部失效。检查 ② 的防火墙规则与 realip 配置"
    else
      ok "公网链路上伪造被真实 IP（$seen_ip）顶掉 —— 客户端 IP 可信"
    fi
  fi
fi

# ══════════════════════════════════════════════════════════════════
printf '\n═══ 结果：%d 通过 / %d 失败 ═══\n' "$pass" "$fails"
if [ "$fails" -gt 0 ]; then
  echo "边缘链路未能保住客户端 IP —— 在修好之前，按 IP 的限频/投票上限都不可信。" >&2
fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
