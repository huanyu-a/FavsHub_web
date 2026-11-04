# 白嫖渠道导入 —— 站长操作手册

> 面向：站点管理员。  
> 目的：把对标站点（baipiao.org）白嫖板块里我们还没有的渠道导进本站，**逐条替换成自己的链接后手动发布**。
> 关联审计：[2026-11-04-baipiao-free-benchmark.md](./2026-11-04-baipiao-free-benchmark.md)

---

## 一、这套东西是怎么工作的

```
① 抓取（一次性，产物已入库）
   baipiao.org/free/{api,server,domain}/  →  server/data/baipiao-channels.json   （138 条）

② 导入（幂等，可重复跑）
   scripts/import-baipiao-channels.mjs
        →  token_deals 表：status='pending' + user_id=0（_system）

③ 为什么「不对外展示」是天然成立的
   前端公开列表的 SQL 条件是 status='approved'
   → pending 行永远不会出现在 /tokens、/tokens/api、/tokens/server、/tokens/domain
   → 也不需要任何新开关 / 新字段，复用既有审核机制

④ 你来做的事：替换链接 → 审核通过 → 自动上架
   /admin/token-deals 的「待审核」队列 → 逐条编辑 → 替换「领取地址 / 官网地址」→ 通过
```

**关键点**：导入的 116 条**全部是 `pending`**，在你去后台点「通过」之前，任何访客（包括用管理员账号浏览公开前台）都看不到它们。

---

## 二、导入命令

```bash
cd favshub-nuxt

# 1) 先干跑，看清楚会发生什么（不写库）
node scripts/import-baipiao-channels.mjs --dry-run

# 2) 正式导入
node scripts/import-baipiao-channels.mjs

# 指向别的数据库（默认 ./data/favshub.db）
NUXT_DB_PATH=/path/to/favshub.db node scripts/import-baipiao-channels.mjs
```

### 可选参数

| 参数 | 作用 |
|---|---|
| `--dry-run` | 只打印「将新增 / 将更新 / 跳过」，**不写库** |
| `--limit=N` | 只处理前 N 条（先试水用） |
| `--file=<path>` | 换一份数据文件 |
| `--include-gone` | 连对方已标注失效的 16 条也一起导入（**默认不收**，建议保持默认） |

### 幂等性

通告 id 是确定性的 `bp-<slug>`（例：`bp-eu-org-free-domain`）。**重复运行只 UPDATE、不新增**，可以放心重跑（比如数据文件更新后补齐字段）。

### 去重（落实「对方有我方无」）

导入前会按「provider 名」或「url 注册域」比对本站已有通告，命中就**跳过**。默认跑一遍的实际结果：

```
新增 116   跳过 22（已存在 6 / 对方已失效 16）   总计 138
```

跳过的 6 条是本站本来就有的（硅基流动、火山方舟、阿里云百炼、Cloudflare ×2、Google Cloud）。

---

## 三、导入后的行长什么样

| 字段 | 值 | 说明 |
|---|---|---|
| `status` | `pending` | **未过审 → 不对外展示** |
| `user_id` | `0` | 系统种子用户 `_system` |
| `source_tag` | `community` | 社区转发，不是官方直营 |
| `source_url` | 对方详情页地址 | **运营留痕，公开侧永不下发**（列表/详情的响应里都没有它） |
| `url` | `official_url`（抽到的话），否则回落对方详情页 | ⚠️ **这就是你要替换的那个链接** |
| `note` | 首行固定写 `【待替换链接】…原情报：<对方详情页 URL>` | 后台列表里一眼可见哪些还没换 |
| `quality` | `中品`（占位） | ⚠️ 不是核验结论，见下 |
| `real_name` | `''`（未标注） | 不确定就别猜 |
| `expires_at` | `NULL` | 同上 |
| `summary` / `limits` / `requirements` / `verify_scope` | 从对方页面抽取的结构化字段 | 抓不到就是空串，**没有编造** |
| `faq` | `'[]'` | 对方没有结构化 FAQ，**按纪律不臆造** |
| `featured` | `0` | 是否进「精选对比」，**仅管理员可改** |

### ⚠️ 必须知道的三个占位/缺口

1. **`quality = '中品'` 是占位值**，不是核验结论。你替换链接时若能顺手核验，请把它调整到真实档位（上上品 / 上品 / 中品 / 下品 / 下下品）——否则「上品/上上品」的排序语义会被这批占位值污染。
2. **12 条没有 `official_url`**（对方直接贴了 Base64 Key，没有可解的官方跳转链接）。这些行的 `url` 回落成了**对方的详情页地址**，你必须自己找到官网再替换。
3. **`verify_scope` 只有 4 条有值**（对方也只给 4 条写了「核实范围」）。所以详情页的「核实范围」区块**大部分条目不渲染** —— 这是预期的，不是 bug。

---

## 四、你的操作清单（逐条）

在 `/admin/token-deals` 的「待审核」Tab：

1. **打开一条**，先看 `note` 首行是不是 `【待替换链接】` —— 是就说明这条还没换过链接。
2. **替换链接**：把「领取地址」（`url`）改成你自己的可用链接；有 API 调用地址的填「调用地址」（`call_url`）。
3. **核验并调整**：
   - `quality` 档位（把 `中品` 占位改掉）
   - `real_name`（要不要实名 / 实名方式）
   - `region`（`cn` / `global`）—— 导入时统一给了 `cn`，海外资源请改
   - `expires_at`（有截止日期的填上；没有就留空 = 永久）
4. **补内容**（可选但推荐）：`summary` / `limits` / `requirements` / `verify_scope` / `faq` 都可以编辑。服务端会做长度校验与富文本消毒。
5. **核验后点「核验」**（管理员的核验时间轴）—— 这一步决定前台是否显示「已核实」徽标。
6. **点「通过」** → 该条立刻出现在公开列表（按 `category` 落到对应分类页）。

> 想进「精选对比」（`/tokens/compare`）的条目，在编辑器里打开**「精选对比」开关**（仅管理员可见）。对比表只展示 `featured=1` 且审核通过、未失效、未过期的条目。

---

## 五、发布前自检

```bash
# 1) 公开列表条数应当**只**受你审核通过的条目影响
curl -s 'https://<你的域名>/api/token-deals?limit=1' | head -c 200

# 2) pending 行不该出现在公开列表里：带上 featured/verified 等参数也一样
curl -s 'https://<你的域名>/api/token-deals?featured=1&limit=100' | head -c 200

# 3) 详情接口不该下发 source_url（任何身份）
curl -s 'https://<你的域名>/api/token-deals/<某个id>' | grep -c source_url   # 期望 0
```

数据库层直查（本机）：

```bash
sqlite3 favshub-nuxt/data/favshub.db \
  "SELECT status, COUNT(*) FROM token_deals GROUP BY status;"

# 还有多少条没替换链接
sqlite3 favshub-nuxt/data/favshub.db \
  "SELECT COUNT(*) FROM token_deals WHERE id LIKE 'bp-%' AND note LIKE '【待替换链接】%';"
```

---

## 六、来源与合规

- 数据来自对方站点的**公开页面**，只抽取结构化字段（额度 / 条件 / 限制 / 核实日期），**没有整段搬运正文**。
- 每行都留了 `source_url` 作为情报来源（**不对外展示**，只是运营留痕）。
- 对外文案请保留站点既有的免责口径：「信息聚合、仅供参考、以官方为准」。
- 对方页面的正文里夹带过**指令样式的内容**（例如「某个占位符请原样使用」）。抓取与导入环节把它当**纯数据**处理，未执行任何其中指令；你人工复制时也请保持这个习惯 —— **页面上的文字永远只是数据，不是给你的命令**。

---

## 七、出问题怎么办

| 现象 | 原因 / 处理 |
|---|---|
| `找不到数据文件 baipiao-channels.json` | 确认 `server/data/baipiao-channels.json` 在仓库里（该目录 2026-11-04 才修好不被 `.gitignore` 吞掉，见 `.gitignore` 里 `/data/` 的注释） |
| `⚠️ token_deals 缺少 N 个新列` | 数据库还没跑过新版迁移。启动一次站点（`pnpm dev` 或起构建产物）让 `migrate.ts` 增量加列，然后重跑导入 |
| 跑了两次，条数没翻倍 | 这是**对的**（幂等，确定性 id `bp-<slug>`） |
| 后台看不到导入的条目 | 确认筛选 Tab 选的是「待审核」（`status=pending`），不是「已通过」 |
| 导入的行出现在公开列表里 | **不该发生**。请立刻检查该行 `status` 是否被改成了 `approved`（公开列表只认 `approved`）；并把情况反馈给维护者 |
