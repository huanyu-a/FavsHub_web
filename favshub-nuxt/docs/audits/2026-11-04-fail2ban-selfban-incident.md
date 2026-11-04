# 事故记录：站长 IP 被自家 fail2ban 封禁 24h（2026-11-04）

## 现象

浏览器访问 `https://hao.bx9y.com.cn/` 报 `ERR_CONNECTION_CLOSED`，
但**同一台机器的 SSH（22 端口）正常**，服务器上 `docker ps` 显示容器 `healthy`、
`curl http://127.0.0.1:3090/api/health` 返回 200，其他外部 IP 的请求也全部 200。

## 根因

家宽出口 IP `43.241.241.190` 被 `f2b-hao-429` 链 REJECT：

```
Chain f2b-hao-429 (1 references)
target     prot opt source               destination
REJECT     0    --  43.241.241.190       0.0.0.0/0   reject-with icmp-port-unreachable
RETURN     0    --  0.0.0.0/0            0.0.0.0/0
```

`banaction = iptables-multiport`、`port = http,https` —— **只封 80/443，不封 22**，
所以 SSH 一直是好的，而 HTTP(S) 全断。这个组合极易被误判成"站点挂了"或"被墙"。

## 触发链

1. 某 `node` 客户端在 **12:00:07–12:00:08 一秒内并发 386 次**
   `GET /api/token-deals?limit=1`（日志 UA 就是 `node`）；
2. 撞满 `hao_api` 总闸（当时 `rate=300r/m` + `burst=100 nodelay`）→ 连环 429；
3. `hao-429` jail 命中 386 次 → `maxretry=10` 远超 → 封 24h（`bantime=86400`）。

**注意：真正的触发路径是 `/api/token-deals`，不是 `/api/favicon`。**
filter 已显式排除 favicon（该 IP 另有 1975 次 favicon 429，但一条都不参与封禁）。
排查时容易看到 favicon 数量最多就归因过去，**这是错的，以 filter 正则为准**。

## 更深的设计问题（本次一并修掉）

`hao_favicon` 原本 `rate=60r/m`、`burst=30`。但实测**正常浏览器单 IP 一分钟
favicon 请求峰值 598 次**（195 行日志里 400–600 次的 IP 比比皆是）——
也就是说这个阈值**连正常访客都过不了**。它当初按「API 限流」的直觉设定，
而 favicon 的请求密度是普通 API 的十倍量级。

## 改动（最小必要，只降误伤、不降防爆破）

| 项 | 原值 | 新值 | 理由 |
|---|---|---|---|
| `hao_api` rate | 300r/m | **600r/m** | 正常首屏峰值接近 400–600 |
| `hao_api` burst | 100 | **300** | 首屏瞬时并发几十个，弱网重试会瞬间填满 |
| `hao_favicon` rate | 60r/m | **600r/m** | 实测正常访客峰值 598/分钟 |
| `hao_favicon` burst | 30 | **300** | 原值等于"第一个访客就打满" |
| `hao-429` maxretry | 10 | **30** | 正常重试不该封 |
| `hao-429` findtime | 600 | **300** | 窗口收窄，避免"十分钟里陆续几次"累加成封 |
| `hao-429` bantime | 86400 | **1800** | 误封最长 30 分钟而非一整天 |
| `bantime.increment` | — | **true** (factor 2, max 28800) | 补回威慑：首次 30 分钟，反复触发 1h/2h/4h，上限 8h |
| `ignoreip` | — | 追加 `43.241.241.190` | 站长 IP 白名单 |

**未改**：`hao_login`（10r/m）、`hao_verify`（6r/m）、各登录端点 `burst=5/6`。
防爆破强度原样保留 —— 只放宽了「正常浏览会被误伤」的那两档。

安全边界说明：`hao_favicon` 放宽到 600r/m 之所以可接受，是因为 SSRF 面由
`server/utils/favicon-download.ts` 的三重校验兜住（协议/主机名白名单、DNS 二次解析、
`redirect:'manual'` 手动跟跳），不依赖这个 nginx 阈值当防线。

## 验证

- `fail2ban-client -t` → OK；`nginx -t` → successful
- filter 正则 6/6 用例：favicon 429 / 详情页 429 / login 200 **不匹配**；
  login 429 / token-deals 429 / verification 429 **匹配**（用 python 等价复算）
- 端到端：`/`、`/tokens`、`/api/health` 全部 200
- **13:22 有 173 请求 / 3 个 429（改前）；13:24 之后 459 请求 / 0 个 429**，
  其中 13:25 的 421 个请求是真实用户加载首页（含 favicon 风暴），全部通过

## 回滚

```bash
bash /root/hao-ratelimit-backup-20261104-132311/ROLLBACK.sh
```
（备份含 4 个原文件 + 可执行回滚脚本；改前文件另存 `*.bak-<时间戳>`）

## 排查方法论（下次遇到"站点打不开"照此走）

1. **先分域**：SSH(22) 通而 HTTP(S) 不通 ⇒ 优先怀疑**按端口的封禁**，不是站点宕机。
2. **用服务端视角定案，不要用本机指标**。本次踩过的三个坑：
   - fake-ip 解析到 `198.18.x.x`（Clash TUN）**不等于**流量走了代理；
   - `api.ipify.org` 的出口 IP **不等于**本站的出口 IP（不同规则走不同出口）；
   - `TcpClient.Bind(物理网卡)` 后的超时**不等于**链路中断（绑定后连百度都不通，
     是方法本身不成立）。
   **可靠的判据只有**：`SSH_CLIENT`（真实家宽 IP）、`iptables -L f2b-*`、
   `fail2ban-client status <jail>`、服务端 nginx 访问日志。
3. **归因封禁前先看 filter 正则**，别用日志里数量最多的路径去猜。
4. 统计日志时注意 IP 在**行首**，`grep " $IP "` 永远匹配不到；用 `awk '$1==ip'`。