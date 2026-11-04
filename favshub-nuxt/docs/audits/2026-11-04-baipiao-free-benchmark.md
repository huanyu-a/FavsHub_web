# 对标审计：baipiao.org 白嫖板块 vs 本站 `/tokens`

- **日期**：2026-11-04
- **对标对象**：<https://baipiao.org/free/>（下称「对方」）
- **我方对象**：`favshub-nuxt` 的 Token 白嫖通告板块（`/tokens`、`/tokens/keys`、`/tokens/[id].html`）
- **审计方法**：逐页抓取对方公开页面 + 通读我方 `pages/tokens`、`components/tokens`、`server/api/token-deals`、`server/database/{schema,migrate}.ts`，按「板块 → 页面 → 字段 → 交互」四层逐项对照。
- **抓取证据**（均为 2026-11-04 实际抓取，HTTP 200）：
  - 白嫖总入口 <https://baipiao.org/free/>
  - 免费 API 列表 <https://baipiao.org/free/api/>（自称 103 条）
  - 免费服务器列表 <https://baipiao.org/free/server/>（22 条）
  - 免费域名列表 <https://baipiao.org/free/domain/>（13 条）
  - 精选对比 <https://baipiao.org/free/api/compare/>
  - 详情页样本 <https://baipiao.org/free/api/qiniu-conatus-daily-free-tokens/>

> 说明：对方页面为聚合信息，本报告只提炼**结构与机制**，不复用其文案。所有对标结论均以抓取到的页面事实为依据，推测项一律标注「未验证」。

---

## 一、结论摘要

对方的优势不在数据量，而在**信息架构**：它把「这条免费资源到底能拿多少、要满足什么条件、什么时候失效、上一次是谁在什么时候核实的」做成了**可对比、可筛选、可逐条核实**的结构化字段与页面。我方 `/tokens` 的机制层（投票、评测、人工核验时间轴、事件流订阅、邀请码池）**明显强于对方**，但**表达层**落后一档：读者要打开详情弹层、读完整段备注，才能拼出「额度 / 条件 / 限制 / 有效期」这四件事。

差距集中在 6 处，本轮全部落地：

| # | 差距 | 对方怎么做 | 我方现状 | 本轮处置 |
|---|---|---|---|---|
| **D1** | 缺「免费域名」分类 | 一级子分类 `/free/domain/`，13 条 | `DEAL_CATEGORIES = ['token','cloud','client']`，无域名 | 新增 `domain` 分类（W1 + W3） |
| **D2** | 详情页无结构化信息块 | 「额度 / 限制 / 有效期」三段独立呈现 + 「核实范围」诚实披露 | 只有 `quota` 一个自由文本字段 + `note` 长备注 | 新增 `summary` / `limits` / `requirements` / `verify_scope` / `faq` 五列 + 详情页四格面板（W1 + W2） |
| **D3** | 无分类落地页 | `/free/api/`、`/free/server/`、`/free/domain/` 三个**独立 URL**，各有导语 + 分类 FAQ | 只有 `/tokens?category=x` 查询参数，无独立 URL、无导语、无 FAQ | 新建 `/tokens/api`、`/tokens/server`、`/tokens/domain`（W3） |
| **D4** | 无对比视图 | `/free/api/compare/` 精选对比表：额度 / 领取条件 / 有效期 / 核实日期 逐列对比 + 入选标准说明 | 无 | 新增 `featured` 列（仅管理员可设）+ `/tokens/compare`（W1 + W3） |
| **D5** | 列表项信息密度低 | 每条直接展示一句话摘要 + 核实状态徽标 + 核实日期 | 卡片无摘要、无核实状态徽标（只有筛选 chip） | 卡片加 `summary` 摘要 + 已核实/待复核徽标（W3） |
| **D6** | 渠道覆盖不全 | 白嫖板块合计约 **138 条**（API 103 + 服务器 22 + 域名 13） | 存在大量对方有、我方无的渠道 | 抓取 + 幂等导入为 `status='pending'`（**不对外展示**），待站长替换链接后手动发布（W4） |

**机制层我方领先项**（对方无、我方可保留并继续宣传）：一人一票可改的可用性投票、一人一评的星级评测与分布、**人工核验时间轴 + 核验流水**、核验新鲜度阈值与「待复核」标记、通告生命周期状态机（已过期 / 判定失效 / 已删除 + 可逆转）、atoms/json feed 事件流与游客机器人订阅、邀请码池的加权随机 + 复制配额 + HMAC 抽中凭证、Turnstile 人机校验、AI/MCP 数据通道。

---

## 二、板块级对照

### 2.1 对方 `/free/` 的板块全貌（抓取事实）

| 对方板块 / 页面 | 内容 | 我方对应 |
|---|---|---|
| `/free/` | 白嫖总入口，3 张分类卡，各带条数与一句话描述 | `/tokens`（**无分类卡**，只有筛选下拉） |
| `/free/api/` | 免费 API / 模型，103 条 | `/tokens`（category=`token`） |
| `/free/server/` | 免费服务器 / VPS，22 条 | `/tokens`（category=`cloud`） |
| `/free/domain/` | 免费域名，13 条 | **无** |
| `/free/api/compare/` | 精选对比（2 项入选）+ 入选标准 + 落选原因 + 验证引导 | **无** |
| `/free-token/codes/` | 免费兑换码 | `token_deal_invite_codes` 邀请码池（**机制更强**，但只在详情页内，无独立入口） |
| `/lottery/` | 免费抽奖 | **无** |
| `/relay/`、`/charity/`、`/price/` | 中转榜单 / 公益站 / 订阅比价（目录型榜单） | **无**（不同业务形态，见 §六 路线图） |
| `/node/verify/`、`/relay/verify/`、`/relay/studio/` | 节点检测 / 中转检测 / AI 生图（工具） | `nexus_*` 表已存在（Nexus 实测可用率）→ 我方有数据、**无独立工具页** |
| `/bbs/` | 社区论坛 | **无** |
| `/news/` | AI 快讯 | **无** |
| 站内 `go.html?u=<urlencoded>` | 所有外链走站内跳转（可统计 + 可挂推广） | 外链直出（无跳转层） |
| 「提交一个可白嫖网站」（匿名入口） | 游客可投稿 | `/api/token-deals` 游客通道（**机制更强**：Turnstile + 每日配额 + 去重） |

### 2.2 对方每个分类页的固定结构（3 页均有，事实）

1. 面包屑（`首页 / 分类名`）
2. `H1` + 条数徽标
3. **一句话导语**（说明这个分类的收录门槛，例：「长期免费的域名与二级域名渠道 —— eu.org 的老牌二级域…每条标注最后验证时间、由社区投票核实」）
4. **筛选项**：`★ 只看收藏` / `提交免费资源` / 核实状态（全部记录 · 近期已核实 · 待复核 · 受限 · 已到期失效）
5. **列表项**：标题 + 状态徽标 + 一段摘要 + `分类路径` + 标签行 + `核实 | 日期`
6. **分类 FAQ 区块**（3~5 问，带 `H2` 标题，如「免费域名常见问题」）

我方的对应缺口：**3、4（核实状态）、5（摘要+徽标）、6**。本轮全部补齐（W3）。

### 2.3 对方详情页的固定结构（样本：七牛云 Conatus）

| # | 区块 | 我方现状 |
|---|---|---|
| 1 | 面包屑 `首页 / 分类 / 标题` | `/tokens/[id].html` 页有面包屑，弹层无 |
| 2 | 首字头像 + 分类徽标 + **核实状态徽标** + **核实日期** | 有首字头像 + 分类徽标；核实信息在正文中段 |
| 3 | `H1` 标题 | 有 |
| 4 | **一句话摘要（TL;DR）** | **无** |
| 5 | 标签行 | 有（models 芯片） |
| 6 | **「额度 / 限制 / 有效期」三段独立信息块** | 只有 `quota` 单字段，`limits`/`requirements` 混在 `note` 里 |
| 7 | **「核实范围」**：「2026-10-26 已核对官方活动页的额度、认证条件和结束时间；**未登录领取或调用**」 | `verify_note` 只有自由文本，**无「核到什么程度」的固定披露位** |
| 8 | 正文：小标题 + **表格**（规则表、参数表、排错表） | `note_html` 支持 Markdown/HTML 表格（**能力已有**，但缺引导） |
| 9 | **代码块**（可复制的 curl 示例） | `note_html` 支持 `<pre><code>`（能力已有） |
| 10 | **「遇到拒绝请求，先看是哪一类」排错表**（401/404/429…） | **无**（结构位缺失） |
| 11 | **FAQ（Q&A 折叠）** | **无** |
| 12 | CTA：`访问官方` / `收藏` | 有 `导入` 等按钮；**无收藏** |
| 13 | **投票**：「这个还能薅吗？还能用 / 已失效」 | 有（社区健康度，**机制更强**：一人一票可改 + 阈值自动失效） |
| 14 | **相关推荐**「薅完这个，接着逛」 | **无** |
| 15 | 底部交叉导航（更多 API / 中转榜单 / 公益站 / 比价） | 无 |

---

## 三、字段级对照（`token_deals` vs 对方条目）

| 能力 | 对方 | 我方字段 | 差距 |
|---|---|---|---|
| 服务商 | 有 | `provider` | — |
| 标题 | 有 | `title` | — |
| 一句话摘要 | 有（列表与详情都展示） | 无 | **D2 新增 `summary`** |
| 免费额度 | 有（独立字段） | `quota` | 已有 |
| 领取条件 / 门槛 | 有（注册/实名/绑卡/审核/邀请码） | 仅 `real_name`（是否实名，枚举） | **D2 新增 `requirements`** |
| 限制条款 | 有（独立字段） | 无（塞在 `note`） | **D2 新增 `limits`** |
| 有效期 | 有（独立字段 + 剩余期） | `expires_at` | 已有 |
| 核实日期 | 有 | `verified_at` | 已有 |
| 核实状态徽标 | 有（规则已核实 / 待复核 / 受限 / 已到期失效） | `verify_stale`（**仅用于筛选，未上卡片**） | **D5** |
| 核实范围（核到什么程度） | 有（固定披露位） | 无 | **D2 新增 `verify_scope`** |
| FAQ | 有（折叠 Q&A） | 无 | **D2 新增 `faq`** |
| 精选对比 | 有（入选 + 落选原因） | 无 | **D4 新增 `featured`** |
| 情报来源留痕 | 无（不公开来源） | 无 | 新增 `source_url`（**运营字段，公开侧永不下发**） |
| 标签 | 有 | `models`（模型清单） | 语义不同，够用 |
| 社区投票 | 有 | 有（更强） | 我方领先 |
| 评测打分 | 无 | 有 | 我方领先 |
| 人工核验流水 | 无 | 有 `token_deal_verifications` | 我方领先 |
| 收藏 | 有 | 无 | **本轮以 localStorage 实现**（无后端表） |

---

## 四、渠道差距（对方有我方无）与导入策略

### 4.1 事实

对方白嫖板块三个分类合计约 **138 条**（页面自报 103 + 22 + 13）。我方种子数据只有 10 条示例通告（`seed-token-deals.ts`）。差异渠道包括但不限于（抓取样本，仅列举结构，不代表我方已核验）：

- **免费 API / 模型**：七牛云 Conatus 每日额度、UCloud AstraFlow 星火赠金、小米 MiMo TTS、硅基流动代金券、Poixe AI `:free` 后缀模型、CodeCraft 折扣码、GMI Cloud 限时、Ollama 官方 Cloud Key、OpenCode Go / Zen 共享 Key、StepFun `step_plan`、LongCat、Captcha.fun 打码、HF Space 共享 API、v0 Team Key 池、火山方舟 Coding Plan …… 以及大量社区共享 Key 条目
- **免费服务器 / VPS**：Oracle Always Free、GCP e2-micro、AWS Free Tier、Cloudflare Workers/Pages、GitHub Codespaces、Render、Nekoweb、Wispbyte、AdkyNet、Tiiny Host、Infrlo、Orkestr、PandaStack、LoliaFRP、Free FRP、Cloudflare Tunnels、BlueServers、007idc、白手起家、DataOnline、sound.jp …
- **免费域名**：eu.org、DigitalPlat FreeDomain（us.kg）、is-a.dev、js.org、DuckDNS、DnsNeko、CodeHost `.cv`、PU Names（pu.gy）、KataBump、DNSHE、NDJP NET、nic.076666.xyz CF Pro 二级域、域名鸡赠送 …

### 4.2 用户诉求与实现方式

> 「将对方有我方无的渠道加进来（**不在前端展示**，需要我去替换链接后**手动展示**）」

实现方式（**复用我方已有的审核机制，不新增状态机**）：

```
抓取 -> server/data/baipiao-channels.json
     -> scripts/import-baipiao-channels.mjs（幂等，id = bp-<slug>）
     -> token_deals 行：status='pending' + user_id=0（_system）
     -> 前端公开列表 SQL 条件是 status='approved'
        => 天然不展示（无需任何新开关）
     -> 管理员后台 /admin/token-deals 审核队列可见
     -> 站长逐条把 url 替换成自己的链接 -> 通过 -> 手动展示
```

要点：
- **不新增「隐藏」字段**：`pending` 语义就是「未过审、不对外」，已有完备的后台队列与审批流，属于最小改动。
- **链接替换留痕**：导入行的 `note` 首行固定写 `【待替换链接】…原情报：<对方详情页 URL>`，站长一眼可见哪些还没换。
- **`source_url` 是运营字段**：记录情报来源，公开侧（列表 / 详情，含管理员浏览前台）**永不下发**。
- **幂等**：确定性 id `bp-<slug>`，重跑只 UPDATE，不产生重复行；已存在于本站的渠道（按 provider 名 / url 注册域匹配）跳过。
- **质量占位**：导入行的 `quality` 统一填 `中品`、`real_name` 空、`expires_at` 空 —— **这是占位值，不是核验结论**；站长替换链接时应顺手核验并调整，否则会污染「上品/上上品」的排序语义。

### 4.3 合规与来源标注

- 导入行 `source_tag='community'`、`note` 注明原情报地址 —— 与本站「信息聚合、以官方为准」的定位一致。
- 对方详情页的正文**不整段搬运**（版权与时效风险），只抽结构化字段（额度 / 条件 / 限制 / 核实日期）。
- 导入完成后的公开文案仍应保留本站既有的免责口径。

---

## 五、本轮落地清单

| 工作流 | 负责 | 产出 | 验收 |
|---|---|---|---|
| **W1 后端** | teammate `be` | `domain` 分类；`token_deals` 新增 7 列（`summary`/`limits`/`requirements`/`verify_scope`/`faq`/`source_url`/`featured`）；列表与详情下发新字段；`limits_html`/`requirements_html` 服务端渲染；新增 `verified=1` / `featured=1` / `exclude=` 查询参数 | `pnpm build` 通过；临时库迁移实测；响应中无 `source_url` |
| **W2 详情页** | teammate `fe-detail` | `TokenDealDetail.vue`：摘要 + 四格信息面板（额度/条件/限制/有效期）+ 核实范围与核验时间轴 + FAQ 折叠 + 收藏 + 相关推荐 + 分类底部导航 | 旧数据不出现空白块；新数据六块齐全 |
| **W3 列表层** | teammate `fe-list` | 抽出 `TokenDealsBoard.vue`；新建 `/tokens/api`、`/tokens/server`、`/tokens/domain`（含导语 + 分类 FAQ）、`/tokens/compare`；卡片加摘要与核实徽标；筛选加核实状态与只看收藏；编辑器加新字段；`useDealFavorites.ts`；sitemap 收录新页 | 五个路由 200；`pnpm build` 通过 |
| **W4 渠道数据** | teammate `crawler` | `server/data/baipiao-channels.json` + `scripts/import-baipiao-channels.mjs` | dry-run 跑通；真跑后 pending 行数增加、approved 行数不变；二次运行幂等 |

---

## 六、本轮**不做**（路线图建议，按性价比排序）

这些都是对方的**其它独立板块**，不属于「白嫖板块」本身，且每一项都是独立产品量级，不应混进本次改动：

1. **外链跳转层** `go.html?u=` —— 我方全站外链直出。加一层跳转可统计点击与挂推广，但要处理开放重定向风险（必须白名单化 + 签名），**建议单独立项并先做安全评审**。
2. **中转榜单 / 公益站 / 订阅比价** —— 目录型榜单，需要新的实体表（站点、价格、倍率、可用性）与抓取管线。
3. **免费兑换码 / 免费抽奖** —— 兑换码我方已有邀请码池（机制更强），只缺独立入口页；抽奖是全新业务。
4. **检测工具页**（节点检测 / 中转检测）—— `nexus_*` 表已有实测数据，缺的是对外查询 UI。
5. **社区论坛 / AI 快讯** —— 论坛是重量级模块；快讯可先用 `/api/token-deals/feed.*` 的既有事件流做轻量版。
6. **收藏的服务端化** —— 本轮用 localStorage 达成功能对齐；跨设备同步需要新表 + 登录依赖。
7. **详情页「排错表」的结构化字段** —— 本轮通过 `faq` + `limits` + Markdown 表格能力覆盖；若日后要固定「401/404/429 排错」版式，再加 `troubleshoot` JSON 列。

---

## 七、审计证据与复现方式

```bash
# 对方页面（结构对照）
curl -s https://baipiao.org/free/              | grep -o '<h1[^>]*>[^<]*'   # 分类卡与条数
curl -s https://baipiao.org/free/domain/       | grep -o '免费域名[0-9]*'
curl -s https://baipiao.org/free/api/compare/  | grep -o '精选[0-9]*项'

# 我方现状
grep -n "DEAL_CATEGORIES" favshub-nuxt/server/utils/token-deals.ts
grep -n "CATEGORY_OPTIONS" favshub-nuxt/components/tokens/TokenFilterBar.vue
grep -n "ALTER TABLE token_deals ADD COLUMN" favshub-nuxt/server/database/migrate.ts
```

**未验证项**（本报告不下结论）：
- 对方「投票」「收藏」「提交免费资源」的后端实现与反刷机制 —— 只观察到前端形态。
- 对方 `/bbs/`、`/price/`、`/relay/` 的数据来源与更新频率 —— 未抓取。
- 对方列表的实际分页上限与全量条数 —— 抓取时列表页被截断，`103 / 22 / 13` 取自页面自报数字。

---

## 八、本轮落地结果（回填，2026-11-04 晚）

> 本节是**事后回填**：一~七节写于动手之前（审计 + 契约冻结），本节记录实际做成了什么、
> 哪些判断在执行中被修正、以及遗留项。操作步骤见 [Import runbook](./2026-11-04-baipiao-import-runbook.md)。

### 8.1 已交付

| # | 内容 | 落点 |
|---|---|---|
| W1 | 新增分类 `domain`；`token_deals` 新增 7 列（`summary`/`limits`/`requirements`/`verify_scope`/`faq`/`source_url`/`featured`）；列表与详情下发新字段 + `limits_html`/`requirements_html`；新增 `verified=1`/`featured=1`/`exclude=` 查询参数；写路径与 AI 通道同步 | `server/**` |
| W2 | 详情页信息架构改版：摘要、结构化信息面板（额度 / 条件 / 限制 / 有效期）、核实范围 + 核验时间轴、FAQ 折叠、收藏、相关推荐、分类底部导航 | `components/tokens/TokenDealDetail.vue` |
| W3 | 抽出 `TokenDealsBoard.vue`；新增 `/tokens/api`、`/tokens/server`、`/tokens/domain`、`/tokens/compare`；首页分类导航卡；筛选栏「核实状态」+「只看收藏」；卡片摘要与核实徽标；编辑器新字段；`useDealFavorites`；sitemap | `pages/tokens/**`、`components/tokens/**`、`composables/useDealFavorites.ts` |
| W4 | 抓取 138 条渠道 → `server/data/baipiao-channels.json`；幂等导入脚本 `scripts/import-baipiao-channels.mjs`（默认导 116 条 `pending`） | `server/data/**`、`scripts/**` |

### 8.2 执行中被修正的判断（重要）

1. **「领取条件」不该硬拆**。原契约要求从对方文本里切出独立的 `requirements`。
   实际数据里两者揉在一句，硬切只能覆盖 15/138 条。**结论：数据侧只做「逐字前缀 + 剩余」的
   无损切分（15 条），显示侧改为多态**：两格 / **一格「限制与领取条件」跨满整行** /
   由 `real_name` 兜底 / 不渲染。依据是复核了对方自身的事实 —— 它详情页标题就叫「限制」，
   对比表列名是「**领取与使用限制**」，本来就是合并的。合并后 138 条这格**全部有内容**，
   且不会出现两格显示同一段文本。

2. **`source_url` 的排除必须写三处**。公开端点是 `...row` 展开全列，所以每加一个内部列都要
   在**列表与详情两条路径**显式置 `undefined`；`ai-service.ts` 的私有字段清单是第三处。三处已同步。

3. **提案通道的列清单会被新字段打穿**。`validateDealPatch`/`diffDealPatch` 以 `DEAL_PATCHABLE` 为准，
   但审核通过时的 `UPDATE` 另有一份列清单 —— 不加就会「校验通过 → 审核通过 → changes 里报告了 →
   主表没写」，属对调用方撒谎。**顺带修掉一处既有缺陷**：同一份 `UPDATE` 原先漏了 `category`。

4. **存量数据要拿「写接口的校验器」当尺子，而不是「读起来合理」**。导入时 `summary` 取自
   详情页 meta description，最长 333 字 > `LIMITS.summary = 200` → 库里躺了一批
   **管理员日后一编辑就 400** 的行。已按句末标点截断 44 条并以「…」标明截断（不伪装成完整句）。
   → 此后灌数据一律先抄 `LIMITS` 上限、落库后做 `MAX(LENGTH(col))` 比对。

5. **幂等判据不能跨副本比全列哈希**。`created_at`/`updated_at` 本来就该变，
   跨副本比会把「导入时刻不同」误报成内容漂移。正确做法：**同一副本跑两次** +
   显式排除语义上该变的列。

6. **`.nuxt` 是共享资源，且没有 `--buildDir`**。`nuxi build` 3.36.1 无隔离构建目录的参数
   （已用 `--help` 核实），`pnpm dev` 与 `pnpm build` 并发会互相清产物，报
   `ENOENT: .nuxt/dist/client/manifest.json` 这类**看起来像代码错了**的假失败。
   处置：统一入口 `bash /tmp/nb.sh`（build）/ `bash /tmp/nd.sh`（dev），共用 flock。
   `nb.sh` 首版有**死锁**（先阻塞等锁、拿锁后才杀 dev，而 dev 持锁到退出 → 互等），
   已改为「非阻塞探测 → 若 dev 持锁则抢占 → 再阻塞排队」；**build 之间的排队不抢占**（那才是正确语义）。

7. **`.gitignore` 的 `data/` 会连带吞掉 `server/data/`**。无前导斜杠的模式匹配任意层级同名目录，
   干净 clone 上导入脚本会因缺数据文件而无法运行。已改为根锚定 `/data/`。

### 8.3 验证方法论（本轮沉淀，后续照用）

1. **SSR 断言不要「用正则猜 class 形状」**。Vue 3 SSR 实测把动态 class 渲染在**静态 class 之前**
   （`class="is-quota tdd-fact"`），且 `v-for` 会注入 `<!--[-->` 注释锚点。用正则猜形状会给出
   **假绿**（格子根本没解析到却报「全部通过」）。正确做法：**解析成 class 列表 + 集合包含判断**。
   本轮该脚本返工 4 版才可信 —— 前三版都是假绿/假红。

2. **「构建通过」不等于「产物对」**。全量构建被他人半成品挡住时，可用
   `@vue/compiler-sfc` 对**自己那个文件**走同一条 postcss 路径编译，并**断言产物里含预期选择器**
   （缺一个就 fail）。pnpm 严格布局下 `@vue/compiler-sfc` 不提升，需从
   `node_modules/.pnpm/@vue+compiler-sfc@*/...` 取绝对路径。

3. **用反面证据证明参数真的生效**。`/tokens/compare` 在无 `featured=1` 行时渲染空态，
   这同时反证了「服务端确实按 `featured` 过滤了」（否则会把 10 条全端上来）。

4. **清理进程不要用过宽的 `pkill -f`**。本轮两起事故：
   - 宽 pattern 匹配到**执行者自己的命令行**导致自杀（`pkill -f "pnpm dev"` 会杀掉发起它的 shell）；
   - 宽 pattern 误杀他人预览进程（`pkill -f '.output/server/index.mjs'`）。
   → 一律 `pgrep` 取明确 PID，或把 pattern 写成字符类（`index[.]mjs`）使其**不匹配自身命令行**。

### 8.4 遗留（下一个里程碑）

1. **编辑器新字段与 `featured` 开关没有真人走过后台**（需要管理员会话）：建议走一遍
   「新建带 FAQ 的通告 → 保存 → 详情页显示 → 勾精选 → 出现在 `/tokens/compare`」。
2. **`/tokens/compare` 在导入后仍可能为空**：`featured` 只有管理员能勾，且未勾选前不展示。
3. **「只看收藏」是纯本地过滤**，SSR 阶段验不到；收藏也未服务端化（见 8.5）。
4. **导入行的 `quality='中品'` 是占位值**，不是核验结论；会污染「上品/上上品」的排序语义，需人工调整。

### 8.5 明确不做的（路线图，见第六节）

外部链接跳转层 `go.html?u=`、中转榜单、公益站、订阅比价、免费兑换码 / 抽奖、
节点与中转检测工具页、社区论坛 / AI 快讯、收藏服务端化、详情页「排错表」结构化字段。

### 8.6 未做的安全审查（**若日后做跳转层，上线前必须补**）

第六节第 1 项的「外部链接跳转层」本轮**未实现**。若日后要做，必须先过：
open redirect 白名单 + 签名校验 + 服务端不跟随重定向 + `nofollow ugc noopener`。
本轮所有对外链接都是直链，不存在跳转层，故无此风险面。

### 8.7 集成验收记录（Lead 亲自执行，2026-11-04 12:0x–12:13）

环境：**生产构建产物**（`.output` 的私有副本）+ **真实库** `data/favshub.db`（导入前已备份到 `/tmp/favshub-prod-before-import.db`）。

**① 构建**：`bash /tmp/nb.sh` → `BUILD_EXIT=0`，`Σ 45.9 MB`，产物 `12:13:40`。
全仓扫过「比产物更新的源文件」= 仅 `scripts/public-field-matrix.mjs`（**不参与 Nuxt 构建**），
故该产物完整包含全部改动。

**② 路由**（真实库，导入 116 条 pending 之后）

| 路由 | 状态 | 字节 |
|---|---|---|
| `/tokens` | 200 | 53128 |
| `/tokens/api` | 200 | 53078 |
| `/tokens/server` | 200 | 21224 |
| `/tokens/domain` | 200 | 21282 |
| `/tokens/compare` | 200 | 15884 |

**③ 可见性（本次最关键的断言）** —— 导入 116 条 `pending` 之后：

```
公开口径 total = 10      ← 导入前也是 10，一条都没漏出来
by status      = [{approved:10}, {pending:116}]
featured=1 → 0    verified=1 → 0    stale=1 → 10    category=domain → 0    category=cloud → 0
pending 行详情：GET /api/token-deals/bp-… → 404 ；GET /tokens/bp-….html → 404
```

**④ 内部字段不泄露**（用「库里 116 行确实有 `source_url` 值」当夹具，比空库更强）

```
列表响应含 source_url 字样     : 0
详情响应含 source_url 字样     : 0
列表 41 键，内部字段出现        : (无)
详情：应在字段缺失 (无) / 不应在字段出现 (无)
verified_by = ""   faq = array(0)   featured = number   limits_html = string
```

**⑤ `scripts/public-field-matrix.mjs` 收紧后复跑**：16 通过 / 1 失败。
失败项是 `token-keys` 解析不出行 —— 查证为**本地 `token_keys` 表 0 行**（数据条件），
且本轮未改动该端点代码（`git status` 为空），**非回归**。

**⑥ 移动端降级（`fe-list` 无法自测的那一项，由 Lead 用 CDP 视口模拟补上）**

`/tokens/compare` 在 **375×800 @2x** 下：表格正确降级为卡片，
每行带 `data-label` 前缀（免费额度 / 领取与使用限制 / 有效期 / 最近核实），
**首末列（资源·接入、操作）不渲染前缀**，「查看详情」变成整宽按钮。
桌面 1280×900 下：6 列表头完整可见、**未被首行遮挡**（`fe-list` 那个 sticky 修复的像素级复核）。

**⑦ 清理**：所有验证服务、headless Chrome 已停止；`:3300`/`:3301`/`:3302`/`:9222` 端口释放；
无 `nuxt dev`/`build` 残留；仓库内无临时文件（`git status` 只剩预期改动）。

**⑧ `public-field-matrix.mjs` 的两处加固（本轮副作用，由 `be` 指出）**

这个脚本是「公开出口 × 内部字段」的回归网，本轮补了两处：

1. **`INTERNAL_KEYS` 加 `source_url`**；同时把新的公开字段加进 `mustKeep`
   （`MUST_KEEP_STRUCTURED` / `MUST_KEEP_STRUCTURED_HTML`）—— 该脚本的第二个职责是
   **防「脱敏过界」**：新公开字段被误删也该报警，而不只是防泄露。
2. **给 `token-keys` 加显式 `allowSkip`**。理由值得单记：`token_keys` 在新部署/开发库里
   常常是空表，探针会因此长期红着；而**一条长期以失败态存在的断言会训练人忽略整个脚本的输出**
   —— 那比少一条探针更危险。脚本本来就设计了 `allowSkip` 机制（跳过必须显式说明理由、
   单独计数、不计入通过数），这里只是正确使用它，**没有放宽全局规则**。

收紧后：**16 通过 / 0 失败 / 1 跳过（未验证）**。

**反向验证过断言确有区分度**（避免自证）：临时把 `mustKeep` 换成不存在的字段名，
探针如实报 `✗ 列表(第1页) 缺字段 …` / `✗ 详情 缺字段 …`，随后还原并复跑转绿。
这条「先证明断言会失败，再相信它会通过」的动作，建议作为写新断言的默认步骤。

#### 仍未验证（需要人工/管理员会话）

1. **编辑器新字段与 `featured` 开关的真人后台操作**（新建带 FAQ 的通告 → 保存 → 详情页 → 勾精选 → 出现在对比页）。
2. **提案通道审核流的真人点测**（提建议改分类 → 审核通过 → 主表已变）。
3. **`/tokens/compare` 的内容密度**：现有 10 条已发布通告都没有 `summary`/`limits`/`verified_at`，
   所以表里「领取与使用限制」整列为「—」、「最近核实」全为「待复核」。
   **这是数据现状而非缺陷** —— 导入的 116 条 pending 行**都有** `summary`/`limits`，
   经人工替换链接 + 勾精选后该表自然会充实。**没有伪造任何 `verified_at`**。
