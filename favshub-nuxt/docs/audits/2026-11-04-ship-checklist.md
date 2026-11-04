# 白嫖板块上线前检查清单（2026-11-04）

> 面向：即将把本批改动提交并发布到生产的人。
> 本批改动 **未提交、未 bump VERSION、未部署**，处于「验证完成、可提交」状态。

## 一、这批改动包含什么

| 范围 | 内容 |
|---|---|
| 后端 | `token_deals` 7 个新列（summary/limits/requirements/verify_scope/faq/source_url/featured）、`domain` 分类、读写 API、AI 通道字段 |
| 详情页 | 摘要 / 四格信息面板 / 核实范围 + 时间轴 / FAQ / 收藏 / 相关推荐 / 分类导航 |
| 列表层 | `/tokens` 重构 + 新增 `/tokens/api`、`/tokens/server`、`/tokens/domain`、`/tokens/compare` |
| 组件 | `TokenDealsBoard.vue`（新）、FilterBar / Card / Editor 增强、`useDealFavorites.ts`（新） |
| 数据 | `server/data/baipiao-channels.json`（138 条）+ 导入脚本 + **已导入 116 条 pending 行** |
| 文档 | `docs/audits/` 三份 |
| 脚本 | `public-field-matrix.mjs` 收紧（加 `source_url` + 新字段 mustKeep + token-keys allowSkip） |

## 二、提交前必须确认（按顺序）

### 1. 确认没混进别人的改动

```bash
cd /path/to/FavsHub_web && git status --short
```

本批应包含的文件见上面第一节。**不属于本批、必须排除**：
- `workflows/`（另一会话的，untracked）
- 若出现 `Dockerfile` / `pages/tokens/keys.vue` / `nuxt.config.ts` 等 a11y-Docker 相关改动，
  先 `git diff` 看清是谁的 —— 另有一会话在同一工作区提交到 `main`。

### 2. 确认 `server/data/` 会被提交、`data/` 不会

```bash
git check-ignore -v favshub-nuxt/server/data/baipiao-channels.json   # 应无输出（=不忽略）
git check-ignore -v favshub-nuxt/data/favshub.db                     # 应有输出（=已忽略）
```

`.gitignore` 已把 `data/` 改成根锚定的 `/data/`，并留了注释说明原因。

### 3. 确认 VERSION 与迁移

```bash
cat favshub-nuxt/VERSION        # 当前 1.0.71（另一会话已发布）
```

**bump 规则**：功能提交**不必** bump。只有在你要**发镜像**时才动它：

```bash
echo "1.0.72" > favshub-nuxt/VERSION
git add favshub-nuxt/VERSION && git commit -m "chore: bump VERSION to 1.0.72"
git push            # 只有推 VERSION 才触发 GHCR 构建
```

### 4. 迁移安全性（已实测）

7 个新列全部通过 `ensureColumn` **逐条独立** `try/catch` 添加：

- 旧库启动时自动补列，**既有数据行取 DEFAULT**（`summary=''`、`faq='[]'`、`featured=0`）；
- 幂等：重复启动不会报错、不会重复 ALTER；
- 索引 `idx_td_featured` 单独 `try/catch`，不与其他语句共享 `exec` 块。

> 这是项目 CLAUDE.md 明确要求的形式（多语句 `db.exec()` 是原子性陷阱，
> 一条失败会静默带走其后全部语句）。改迁移时务必保持这个写法。

**回滚不需要数据迁移**：新列多出来不影响旧代码（旧代码 `SELECT *` 会拿到多余列但不用它）。

## 三、部署时的坑（来自 `DEPLOYMENT-STATE.md`，务必读）

### ⚠️ 推送 VERSION 之后、CI 完成之前，**不要**执行 `docker compose pull`

`compose.yaml` 里是 `pull_policy: if_not_present`，而 GHCR 的 `latest` 可能**落后于**
生产实际运行的镜像。此时 `pull` 会把生产**拉回旧版**。

正确顺序：
```bash
# 1. 先确认 CI 产物真的可拉
docker manifest inspect ghcr.io/huanyu-a/favshub:1.0.72 | head

# 2. 用具体版本号，不用 latest
docker compose pull favshub            # 前提：compose 指向的 tag 已是新版本
docker compose up -d --remove-orphans

# 3. 闸门：镜像 label 必须与 VERSION 一致，不符就回滚
docker inspect favshub_b8j8-favshub-1 \
  --format '{{index .Config.Labels "org.opencontainers.image.version"}}'
curl -s https://hao.bx9y.com.cn/api/health
```

### 回滚锚点

`DEPLOYMENT-STATE.md` 记录了按日的 rollback tag（`rollback-YYYYMMDDHHMMSS`）。
本次发版前**先记下当前镜像 digest**，回滚才有依据：

```bash
docker inspect favshub_b8j8-favshub-1 --format '{{index .RepoDigests 0}}'
```

## 四、发布后立刻验的 5 件事

```bash
B=https://hao.bx9y.com.cn
# ① 五个前台路由
for p in / /tokens /tokens/api /tokens/server /tokens/domain /tokens/compare; do
  printf '%-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' $B$p)"
done
# ② 公开列表条数（116 条 pending 不得泄漏）
curl -s "$B/api/token-deals?limit=1" | grep -o '"total":[0-9]*'
# ③ 新增字段已下发（有数据后才非空）
curl -s "$B/api/token-deals?limit=1" | grep -c '"summary"'
# ④ source_url 绝不出现
curl -s "$B/api/token-deals?limit=20" | grep -c 'source_url'    # 应为 0
# ⑤ 内部字段全矩阵回归
cd favshub-nuxt && node scripts/public-field-matrix.mjs $B
```

第 ⑤ 项应输出 **16 通过 / 0 失败 / 1 跳过**（跳过的是 token-keys，库为空表时属正常）。

## 五、上线后运营动作

见 [bp-channels-todo.md](bp-channels-todo.md)。摘要：

- 116 条 `bp-` 行全部 `pending`，**前台一条都看不到**；
- 逐条替换链接 + 填 `quality`/`expires_at`/`real_name` 后才能 approve；
- **12 条没有官网**（对方是 Key/Token 池），建议驳回或找真实官网，不要原样发布；
- 建议先做免费域名 13 条，数量少、可快速验证分类页效果。

## 六、已知遗留（不阻塞发布）

| 项 | 说明 |
|---|---|
| PUT 是**全量替换** | 漏传 `faq`/`summary` 等会被清空。前端编辑器总是发全字段，UI 无风险；**脚本/第三方调用方要注意** |
| `featured` 无数量上限 | 谁都能勾多条进对比页。属运营策略，未擅自加限制 |
| `verified=1` 是滑动窗口 | 用的是配置项 `deal_verify_stale_days`（默认 30 天） |
| 对比页内容密度 | 现有 10 条已发布通告都没有 `summary`/`verified_at`，故该页暂时较空。**导入的 116 条都有 summary**，approve 后会充实 |