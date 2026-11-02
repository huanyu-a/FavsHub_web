# 部署状态与注意事项

> **读者：执行部署的人 / AI 助手。**
> 本文件记录**当前生产环境的状态**与易踩的坑。日常部署步骤见 `README.md`；
> 含密码的本机步骤见 `DEPLOY.md`（gitignore，不入库）。

**最后更新：2026-11-02（第 10 次修订：正式部署 1.0.61，侧边栏待审徽章与全站 Tab 路由双向同步）**

## ✅ 当前状态：生产已跑 CI 构建的正规镜像 1.0.61（2026-11-02）

生产现在运行的镜像由 GitHub Actions 构建并推送：

| 项 | 值 |
|---|---|
| **版本** | `1.0.61` |
| **来源提交** | `d04b20a53d8374724f1332f5e1b18df5ff9fe90c` |
| **`latest` / `1.0.61`** | 指向当前最新构建 |
| **CI run** | #56（41408678683），21 步全过，962 项断言 |
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **5 通过 / 0 失败** |
| **重构与优化** | 侧边栏全局待审角标、`/admin/bot` Tab 前进后退监听、`/admin/guest-reviews` 状态与搜索全量 Query 同步 |
| **技能包版本** | `favshub-data-ops` **`v1.11.0`**（全面优先推荐 Hermes 方案）|

- 核心特性已上线：
  - **侧边栏全局待审角标**：在管理后台左侧侧边栏，为「提示词管理」、「白嫖通告」、「游客评测」实时注入橙色数字角标，管理员身处任何子页面均能一眼感知待处理审核数量；非管理员零开销不请求；
  - **`/admin/bot` Tab 路由双向同步**：增加 `watch(() => route.query.tab)`，彻底解决浏览器前进/后退时页面内容不同步问题；非法 query 自动纠偏；
  - **`/admin/guest-reviews` Query 全量持久化**：四态切换、分页、通告 ID 精准定位与关键词搜索全量同步至 URL Query，支持刷新保持与团队协作无损分享。

## 历史：1.0.60 状态（2026-11-02）
  - **在线连通性自检（`POST /api/admin/bot/test`）**：在管理后台一键发送测试群消息，即时回显成功/失败诊断；
  - QQ 机器人官方 OpenAPI 直连（`api.bot.qq.com` 纯 HTTPS 无状态直连，零第三方框架依赖）；
  - 自动处理 `304003` 网址未报备降级、`40054010` 禁止URL降级、自增 `msg_seq` 防 `40054005` 消息去重拦截；
  - `40034105` 主动权限、`40034100` 频控、`40054002` 禁言等高频状态精准中文诊断；
  - 多 QQ 机器人与多群 OpenID 广播，目标前缀规范化（剥离 `qqbot:`）；
  - 官方 Webhook 入站（`/api/bot/qq`）：原生 Ed25519 握手与被动回复支持。

## 历史：1.0.57 状态（2026-11-02）
  - **在线连通性自检（`POST /api/admin/bot/test`）**：在管理后台一键发送测试群消息，即时回显成功/失败诊断；
  - QQ 机器人官方 OpenAPI 直连（`api.bot.qq.com` 纯 HTTPS 无状态直连，零第三方框架依赖）；
  - 自动处理 `304003` 网址未报备降级、`40054010` 禁止URL降级、自增 `msg_seq` 防 `40054005` 消息去重拦截；
  - `40034105` 主动权限、`40034100` 频控、`40054002` 禁言等高频状态精准中文诊断；
  - 多 QQ 机器人与多群 OpenID 广播，目标前缀规范化（剥离 `qqbot:`）；
  - 官方 Webhook 入站（`/api/bot/qq`）：原生 Ed25519 握手与被动回复支持；
  - 游客通告订阅（`favshub-data-ops` v1.11.0）：支持纯 Python 原生直连 QQ 官方机器人群推送，脱离 Hermes 依赖。

## 历史：1.0.56 状态（2026-11-02）
  - 多 QQ 机器人与多群 OpenID 广播，目标前缀规范化（剥离 `qqbot:`）；
  - 官方 Webhook 入站（`/api/bot/qq`）：原生 Ed25519 握手与被动回复支持；
  - 游客通告订阅（`favshub-data-ops` v1.11.0）：支持纯 Python 原生直连 QQ 官方机器人群推送，脱离 Hermes 依赖。

## 历史：1.0.55 状态（2026-10-31）

**手工组装补丁镜像的历史到此结束。** 生产现在运行的镜像由 GitHub Actions 构建并推送：

| 项 | 值 |
|---|---|
| **版本** | `1.0.55` |
| **来源提交** | `417696cb13f5d1067734ea1c25f49b4727e825fd` |
| **镜像 ID** | `sha256:421e28c86819…` |
| **GHCR 索引 digest** | `sha256:389c6605d719edf25161ef002209974e62e05b16234a5ea2d34ad8f712e7ef71` |
| **`latest` / `1.0.55` / `sha-417696c`** | 三者指向**同一个** digest（上面那个）|
| **CI run** | #50，6 分 18 秒，21 步全过，962 项断言 |
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **5 通过 / 0 失败** |
| **回滚锚点** | `ghcr.io/huanyu-a/favshub:fix-col404-4c33a83`（`sha256:01e3ed69…`，本地仍在）|

镜像里的 OCI 标签可自证来源（`docker inspect <img>`）：

```
org.opencontainers.image.version  = 1.0.55
org.opencontainers.image.revision = 417696cb13f5d1067734ea1c25f49b4727e825fd
```

### ⚠️ 但「推送前不要 pull」这个坑**没有消失**，只是这次躲过了

下面那一大段保留原文 —— 它是**每一次发版都会重新遇到**的操作顺序问题，
不是一次性事故。规则：

> **push → CI 跑完 → 先确认 GHCR `latest` 的 digest 变了 → 才 `pull`。**

判断方法（这次就是这么做的）：

```bash
docker buildx imagetools inspect ghcr.io/huanyu-a/favshub:latest | grep -m1 Digest
```

它必须等于 CI 里那个 `sha-<短提交>` 的 digest。**跳过这一步就可能把生产拉回旧版却以为在升级。**

## 历史：2026-10-31 之前的状态（保留原记录）

| 位置 | 当时的内容 |
|---|---|
| **GHCR 上的 `latest`** | `1.0.54`（`sha-07017b8`）= 仓库 `origin/main` 的快照 |
| **生产服务器本地 `latest`** | 手工组装的镜像 **`fix-col404-4c33a83`**（`sha256:01e3ed69…`），**比 GHCR 新** |
| **生产容器实际运行** | 就是上面那个手工镜像 |

因为 `compose.yaml` 写的是 `image: ...:latest` + `pull_policy: if_not_present`，
**在当时执行 `docker compose pull favshub` 会把生产拉回 `1.0.54`**，
丢掉下面这 11 项修复：

### 佐证：本地镜像根本没有 RepoDigests（2026-10-31 实测）

这一条不是推测，有直接证据。逐个查 `docker inspect <img> --format '{{.RepoDigests}}'`：

| tag | RepoDigests |
|---|---|
| `latest` | **（空）** |
| `fix-col404-4c33a83` | **（空）** |
| `fix-describe-cdaaf47` | **（空）** |
| `rollback-20261010` | **（空）** |

经 `docker pull` 得到的镜像，Docker 一定会记录 `RepoDigests`（形如
`ghcr.io/…@sha256:…`）。**全为空 ⇒ 这台机器上的 favshub 镜像从未从 registry 拉过**，
都是本地构建 / `docker load` 来的 —— 与「手工组装补丁镜像」的部署方式吻合。

> **2026-10-31 部署后这条已改变**：执行过 `docker compose pull` 之后，
> `latest` 现在带 digest 了 —— `ghcr.io/huanyu-a/favshub@sha256:389c6605…`。
> 也就是说 **RepoDigests 是否为空，本身就是「这台机器上的镜像来自哪」的判据**：
> 为空 = 手工镜像，有值 = registry 拉取。下次怀疑「生产跑的到底是什么」时可以直接看它。

两边实际的 digest：

```
GHCR latest : sha256:7264b8f9b383f24131644489d5aa7f9157c0f61d5b5bfae3552a54d5c3846fe6
本地 latest : sha256:01e3ed69821bcce630df68974927ac54905cb2b3b7169c081ea1aa3ecda38806
```

**顺序必须是：push → CI 推完 → 先确认 GHCR latest 的 digest 变了 → 才 pull。**
跳过「确认 digest」这一步，就可能把生产拉回旧版却以为在升级。

另外记一个容易误会的点：`pull_policy: if_not_present` 只影响 **`compose up` 时
要不要自动拉**，对显式 `docker compose pull favshub` 无效 —— 那条命令一定会去拉。

| # | 修复 | 提交 |
|---|---|---|
| 1 | 无码时隐藏整条「领取地址」行 | `18cdcfc` |
| 2 | 「API 地址」行不再被误隐藏（曾影响 39/46 条通告） | `18cdcfc` |
| 3 | 公开事件流不再下发邀请码占位符与码池明文 | `b04916f` |
| 4 | 公开详情不再透传 `deleted_at` / `invalid_reason` | `3d7c569` |
| 5 | AI 通道内部字段清单补齐（3 → 5 项） | `d4b8962` |
| 6 | 公开列表同样剔除 `deleted_at` / `invalid_reason` | `144fc9c` |
| 7 | `prompts` 列表不再透传 `deleted_at` | `99b2f01` |
| 8 | `prompts` 详情同样不下发 `deleted_at` | `d4c2c24` |
| 9 | `prompts` 已软删除条目不再对他人/匿名公开（回收站私有化） | `a6f1155` |
| 10 | `/api/ai/describe` 字段字典不再宣称已下发的字段 | `cdaaf47` |
| 11 | `/collections/<不存在>` 返回 404，不再软 404 | `4c33a83` |

**正确顺序**：先把本地提交推送到 `origin/main` → 等 CI 构建完 → 再 `pull`。
推送后 CI 先跑 **9 个测试套件**（3 个自包含：`private-ip-check` / `sanitize-test` /
`ssrf-pin-check`；6 个跑产物：`second-batch-e2e` / `third-batch-detail` /
`third-batch-notify` / `third-batch-ratelimit` / `cache-privacy-check` /
`third-batch-server`，共 **962 项断言**），另加 `ts:check` 与文档数字一致性检查，通过才构建镜像。

| 套件 | 断言数 | 需要 Node 22 |
|---|---|---|
| `ts:check`（具名导入） | 895 | |
| `private-ip-check` | 102 | **是** |
| `sanitize-test` | 17 | **是**（`--experimental-strip-types`） |
| `ssrf-pin-check` | 12 | |
| `cache-privacy-check` | 20 | |
| `second-batch-e2e` | 150 | |
| `third-batch-detail` | 247 | |
| `third-batch-notify` | 161 | |
| `third-batch-ratelimit` | 106 | |
| `third-batch-server` | 147 | |
| **合计（断言）** | **962** | |

`sanitize-test` 与 `private-ip-check` 都要 **Node ≥ 22.6**（`--experimental-strip-types`
直接加载 `.ts` 源文件），CI 用的是 `node-version: 22`，不要降到 20 ——
在 Node 20 下 `private-ip-check` 会报 `ERR_UNKNOWN_FILE_EXTENSION ".ts"` 而**假失败**。

**不在 CI 里**（需真实环境或直接打生产，故列为部署后手动核对项）：
`ai-api-smoke-read`（122 项）、`public-field-matrix`（17 项）、`full-deal-row-audit`。

### 生产镜像落后 HEAD 的那部分：既有注释，也有**功能修复**

生产跑的是 `fix-col404-4c33a83`，HEAD 比它多 **36 个提交**（14 个文件，+504/−62）。

⚠️ **2026-10-31 更新：此前这里写「改动 100% 是注释」，该结论已失效。**
后续几轮审查又发现并修了 3 处**真实运行时缺陷**，所以这次部署**不再是纯追平**：

| 文件 | 改动性质 | 影响 |
|---|---|---|
| `server/utils/deal-events.ts` | **功能**：`containsPoolCode` 加最小码长 4 位 | 防止短码（如 `"a"`）让公开链接被误清空 |
| `server/utils/ai-service.ts` | **功能**：`listPrompts` 补 `?recycle=1` 分支 | 此前文档承诺了该能力但代码没实现（静默失效） |
| `server/api/mcp.post.ts` | **功能**：`list_prompts` 暴露 `recycle` 参数 | 此前 REST 能用、MCP 用不了 |
| `server/api/prompts/[id].get.ts` | 纯注释 | 无 |
| `server/api/prompts/index.get.ts` | 纯注释 | 无 |
| `server/api/token-deals/[id].get.ts` | 纯注释 | 无 |

其余提交改的是 CI 配置、部署文档、测试脚本、AI 技能包（`favshub-data-ops/` 1.10.2 → 1.10.3）、
manifest（`skill-manifest.ts` / `public/skills/*.json`）。

**结论（已修正）**：
- 部署后**有**行为变化，共 3 处，都是「堵漏 / 补承诺」，不是新功能界面；
- 这 3 处对现有数据的影响面**当前为 0**（生产码池 3 个码均 ≥6 位；提示词 46 条、
  0 条软删除），所以**上线不会立刻改变可见结果**，属于预防性修复；
- 回滚到 `4c33a83` 会丢掉这 3 处修复与前 11 项修复 —— 但**不会**造成数据不兼容
  （零 schema / 零迁移改动，见下）。

### CI 里新增的三个 e2e 套件

`second-batch-e2e`（150）/ `third-batch-notify`（161）/ `third-batch-detail`（247）/ `third-batch-server`（147）
原先**从未进过 CI**。它们需要 `.output/`，所以排在 `pnpm build` 之后；实测合计 9–15 秒。

⚠️ **这些套件内部 `spawn('node', ...)` 取 PATH 上的 node，而 `better-sqlite3` 是原生模块、
ABI 与 Node 大版本绑定。**手工在本地跑时，必须用「装 `node_modules` 的那个 Node」去跑，
否则会得到极具误导性的报错「应用 30s 内未就绪」（真实原因藏在应用 stderr 的
`NODE_MODULE_VERSION xxx vs yyy`）。CI 里 install 与 run 都是 node 22，不会遇到。

## 回滚档

服务器上按 tag 保留了逐次部署的镜像，回滚只需改 `compose.yaml` 的 tag 并 `up -d`
（**不要**先 `rmi`）。

**注意 `fix-X` 与 `rollback-before-X` 是同一个 image ID 的两个标签**，不占额外空间
（18 个 tag 只对应 9 个唯一镜像 ≈ 2.8GB）。

| tag（= 同一镜像的别名） | 内容 |
|---|---|
| **`1.0.55` = `latest` = `sha-417696c`** | **CI 正规镜像（当前生产，`sha256:421e28c8…`）** |
| **`fix-col404-4c33a83`** | 手工镜像：全部 11 项修复（**2026-10-31 部署前的生产，现为回滚锚点**）|
| `rollback-before-col404` | 去掉「精选集不存在返回 404」 |
| `fix-describe-cdaaf47` | 去掉 describe 字段字典修正 |
| `rollback-before-describe` | 去掉上述两项 |
| `fix-precycle-a6f1155` | 去掉 describe 修正 |
| `rollback-before-precycle` | 去掉 prompts 隐私修复 |
| `fix-pdetail-d4c2c24` | 去掉 prompts 详情脱敏 |
| `fix-prompts-99b2f01` | 去掉 prompts 列表脱敏 |
| `fix-list-144fc9c` | 去掉 token-deals 列表脱敏 |
| `fix-fields-3d7c569` | 去掉 token-deals 详情脱敏 |
| `fix-events-b04916f` | 去掉事件流脱敏 |
| `fix-claimrow-18cdcfc` | 去掉领取行/API 行修复 |

**回滚链已验证可用**（2026-10-31 实测）：9 档逐个冷启动均为 `running`；
最旧档 `fix-claimrow-18cdcfc` 配**当前生产库副本**能正常启动，
`/api/health` 返回 `{"status":"ok","database":"connected"}`、`/api/token-deals` 正常出数据。
本轮 58 个提交**零 schema / 零迁移改动**，所以回滚不存在结构不兼容
（两个方向都验过：旧镜像启动后 `token_deals` 仍是 34 列、42 张表，与回滚前一致）。

## 为什么用「补丁镜像」而不是完整重建

服务器 `apk add gcc` 走官方源极慢，所以不在服务器上跑完整 `docker build`。

**2026-10-31 补了量化数据**（此前只记「>18 分钟未完成」，看不出是卡死还是慢）：

```
apk add curl  （13 MB）→ 1 分 55 秒   ≈ 113 KB/s
apk add gcc 全套（188 MB）→ 按此速度约 28 分钟
实际跑              → 17 分钟后仍停在 (12/30) Installing gcc
```

**结论：不是卡死，是带宽只有 ~110 KB/s。** 完整 build（apk + `pnpm install` +
`pnpm build`）预计 40–60 分钟，**只可当兜底，不可当常规路径**。
日常仍是「CI 建镜像 → 服务器 `pull`」（pull 走 mihomo 代理，快）。

当前做法是**本机构建 → 只拷贝产物**：

```dockerfile
FROM ghcr.io/huanyu-a/favshub:latest
COPY .output/server/chunks      /opt/favshub/.output/server/chunks
COPY .output/server/index.mjs   /opt/favshub/.output/server/index.mjs
COPY .output/server/package.json /opt/favshub/.output/server/package.json
COPY .output/public             /opt/favshub/.output/public
```

**关键：不拷贝 `node_modules`。** 本机是 macOS（`.node` 为 Mach-O），容器是
alpine（musl x86_64）。把本机的原生模块带进去会报 `Error loading shared library`。
保留基础镜像自带的 musl 版本。

打包时用 `COPYFILE_DISABLE=1 tar czf`，否则 macOS 的 `._*` 文件会让 `docker build`
报 `Unexpected "\x00"`。

## 本地构建的两个必需动作

1. **重签原生模块**（本机 Node 是硬化运行时签名，adhoc 签名的 `.node` 加载会失败）：
   ```bash
   for f in $(find .output/server/node_modules -name "*.node"); do
     codesign -f -s - --entitlements <ent.plist> "$f"
   done
   ```
2. **还原被构建改写的文件**（`build` 会重写这两个，不该提交）：
   ```bash
   git checkout -- public/skills/favshub-data-ops.json server/utils/skill-manifest.ts
   ```

## 验证清单（每次部署后）

> **一键版（推荐）**：`node scripts/post-deploy-verify.mjs`
> 它按顺序跑下面 5 项、逐项判定、**任一项失败即非零退出**。
> 加 `--skip-suites` 只跑 curl 那几项（几秒出结果）。

```bash
# 1) 健康检查（期望 200）
curl -s -o /dev/null -w "%{http_code}\n" https://hao.bx9y.com.cn/api/health

# 2) 公开出口 × 内部字段 全矩阵探针（期望 17 通过 / 0 失败）
cd favshub-nuxt && node scripts/public-field-matrix.mjs

# 3) 全量通告「两行可见性」审计（期望 两行都无:0 / 错误:0）
#    这是「API 地址行被误隐藏」那个 bug 的回归哨兵
node scripts/full-deal-row-audit.mjs        # 支持 --base / --limit / --concurrency

# 4) 软 404 回归（期望 404）
curl -s -o /dev/null -w "%{http_code}\n" -H "User-Agent: Mozilla/5.0" \
  https://hao.bx9y.com.cn/collections/nonexistent_xyz

# 5) 关键页面冒烟（期望全 200）
for p in / /tokens /tokens/keys /prompts /collections; do
  printf "%s " "$(curl -s -o /dev/null -w '%{http_code}' https://hao.bx9y.com.cn$p)"; echo "$p"
done
```

`public-field-matrix.mjs` 是**只读探针**，检查「公开出口 × 内部字段」全矩阵：
token_deals 列表/详情/SSR、prompts、collections、tags、token-keys。
它会把「跳过」单独计数——**跳过不等于通过**，看到跳过要查清原因（2026-10-31 加严：
非 200 或不可解析一律计失败，只有显式 `allowSkip` 才跳过）。

## 生产环境事实

- 服务器：3G RAM / 4 CPU，`/` 约 **9.4G 可用（87% 已用）** —— 磁盘偏紧，清理前先确认是否本项目的
  （本项目回滚档 9 个唯一镜像 ≈ 2.8GB；占大头的是其它项目：`rust:1-bookworm` 1.57G、
  `agentmemory/*` 约 5.6G）
- 可安全回收的：悬空镜像 4 个（690M）+ build cache 2.12G，命令
  `docker image prune -f && docker builder prune -f` —— **不会**删掉有标签的回滚档
- 数据库：`data/favshub.db` 4.3M / WAL 338K / 41 张表 / 空闲页 0（无需 VACUUM）
- 备份：每日 03:00 自动（`data/backups/auto-backup-*.db`），保留 7 份 ≈ 29M，
  今日备份 `PRAGMA integrity_check` = **ok**（已验可恢复）
- `dockerd` 走本机 mihomo 代理访问 ghcr.io（境内直连会卡死）
- 改 docker 代理配置会重启该机全部 20 个容器，非必要不要动
- 容器内 nginx 对 `/api/**` 加 `private, no-cache`，公开页面仍走 CDN 缓存
- 容器内 Node **v20.20.2**（满足 Nuxt 的 `^20.19.0`）；CI runner 用 Node 22（测试需要
  ≥22.6 的 `--experimental-strip-types`），两者分工不同、都不是笔误