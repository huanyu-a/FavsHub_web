# 部署状态与注意事项

> **读者：执行部署的人 / AI 助手。**
> 本文件记录**当前生产环境的状态**与易踩的坑。日常部署步骤见 `README.md`；
> 含密码的本机步骤见 `DEPLOY.md`（gitignore，不入库）。

**最后更新：2026-10-31**

## ⚠️ 最重要的一条：推送前不要执行 `pull`

| 位置 | 当前内容 |
|---|---|
| **GHCR 上的 `latest`** | `1.0.54`（`sha-07017b8`）= 仓库 `origin/main` 的快照 |
| **生产服务器本地 `latest`** | 手工组装的镜像，**比 GHCR 新**（含 7 个未推送的修复） |
| **生产容器实际运行** | 就是上面那个手工镜像（`sha256:c466465aed…`） |

因为 `compose.yaml` 写的是 `image: ...:latest` + `pull_policy: if_not_present`，
**现在执行 `docker compose pull favshub` 会把生产拉回 `1.0.54`**，
丢掉这些修复：

1. 无码时隐藏整条「领取地址」行
2. 「API 地址」行不再被误隐藏（曾影响 39/46 条通告）
3. 公开事件流不再下发邀请码占位符与码池明文
4. 公开详情/列表不再透传 `deleted_at` / `invalid_reason`
5. AI 通道内部字段清单补齐
6. `prompts` 列表/详情不再下发给匿名
7. `prompts` 已软删除条目不再对他人/匿名公开（回收站私有化）

**正确顺序**：先把本地提交推送到 `origin/main` → 等 CI 构建完 → 再 `pull`。
推送后 CI 会先跑 131 项测试（`private-ip-check` / `sanitize-test` /
`ssrf-pin-check` / `ts:check`），通过才构建镜像。

## 回滚档

服务器上按 tag 保留了逐次部署的镜像，回滚只需改 `compose.yaml` 的 tag 并 `up -d`
（**不要**先 `rmi`）：

| tag | 内容 |
|---|---|
| `fix-precycle-a6f1155` = `latest` | 全部 7 项修复（当前生产） |
| `rollback-before-precycle` | 去掉 prompts 隐私修复 |
| `fix-pdetail-d4c2c24` | 去掉 prompts 详情脱敏 |
| `fix-prompts-99b2f01` | 去掉 prompts 列表脱敏 |
| `fix-list-144fc9c` | 去掉 token-deals 列表脱敏 |
| `fix-fields-3d7c569` | 去掉 token-deals 详情脱敏 |
| `fix-events-b04916f` | 去掉事件流脱敏 |
| `fix-claimrow-18cdcfc` | 去掉领取行/API 行修复 |

## 为什么用「补丁镜像」而不是完整重建

服务器 `apk add gcc` 走国内镜像极慢（实测 >18 分钟未完成），所以不在服务器上
跑完整 `docker build`。当前做法是**本机构建 → 只拷贝产物**：

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

```bash
curl -s https://hao.bx9y.com.cn/api/health          # 期望 200
cd favshub-nuxt && node scripts/public-field-matrix.mjs   # 期望 17 通过 / 0 失败
```

`public-field-matrix.mjs` 是**只读探针**，检查「公开出口 × 内部字段」全矩阵：
token_deals 列表/详情/SSR、prompts、collections、tags、token-keys。
它会把「跳过」单独计数——**跳过不等于通过**，看到跳过要查清原因。

## 生产环境事实

- 服务器：3G RAM / 4 CPU，`/` 约 9.2G 可用
- `dockerd` 走本机 mihomo 代理访问 ghcr.io（境内直连会卡死）
- 改 docker 代理配置会重启该机全部 20 个容器，非必要不要动
- 容器内 nginx 对 `/api/**` 加 `private, no-cache`，公开页面仍走 CDN 缓存