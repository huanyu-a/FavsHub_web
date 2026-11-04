# 白嫖板块发货就绪报告（2026-11-04）

> 本报告记录 task-5「收口」的全部验证结果。
> **结论：本批改动处于「可提交」状态。未提交、未 bump VERSION、未部署。**

## 零、环境与方法

- 服务：**构建产物**（`.output` 私有副本）起独立实例，端口 3310/3311
- 数据库：**真实库副本**（`cp data/favshub.db /tmp/.../final.db`），生产库全程未写入
- 身份：在库副本上自建 `vr_admin`(is_admin=1) / `vr_user`(is_admin=0)，密码统一
- 工具：新增 `scripts/verify-admin-flow.mjs`（可复跑，见附录）

**为什么必须在库副本上做**：R1 的验证要建通告、批准提案、改 `featured` —— 全是真实写操作。
在真实库上跑会把验证数据混进生产待审队列。

---

## 一、R1 管理员链路验证：**21 通过 / 0 失败**

由 `node scripts/verify-admin-flow.mjs http://127.0.0.1:3311 <db副本>` 可完整复现：

```
▶ 1. 登录
  ✓ 管理员与普通用户均登录成功

▶ 2. 管理员创建：新字段落库 + 服务端渲染
  ✓ summary / limits / requirements / verify_scope 四项回读一致
  ✓ faq 是 2 条数组
  ✓ limits_html 由服务端渲染（含 <strong>，证明走了 marked）
  ✓ source_url 不下发（任何身份）

▶ 3. featured 仅管理员可写
  ✓ 管理员 PUT featured=1 → 200 且 ?featured=1 能命中
  ✓ 普通用户创建时 featured 被忽略（DB featured=0）
  ✓ 普通用户 PUT 传 featured=1 被忽略（DB featured=0）

▶ 4. PUT 是全量替换
  ✓ title 已更新
  ✓ summary 被清空、faq 被清空   ← 语义已证实

▶ 5. 提案通道改 category
  ✓ 建议提交 → 批准 200 → 主表 category 由 token 变为 cloud
```

### 1.1 XSS 消毒（额外验的，不在原计划）

普通用户写恶意 `limits`，服务端渲染结果：

| 输入 | 输出 |
|---|---|
| `<script>alert('XSS1')</script>` | **完全剥离** |
| `<img src=x onerror="alert('XSS2')">` | `<img src="x" />`（`onerror` 剥离） |
| `[点我](javascript:alert('XSS3'))` | `<a rel="noopener noreferrer" target="_blank">点我</a>`（**协议剥离**） |
| `<iframe src="https://evil.example">` | **完全剥离** |
| `<style>body{display:none}</style>` | **完全剥离** |

5/5 通过。原始 `limits` 仍保留 `<script>` 原文供编辑器回填 —— **这是正确设计**（前端只 `v-html` 服务端渲染好的 `limits_html`，绝不自己渲染原文）。

### 1.2 提案通道 `category` —— 本轮最有价值的一条

`be` 修完这个缺陷后只做过静态分析，**从未在真实链路上跑过**。现在证实：
提交「改分类」建议 → 管理员批准 → 主表 `category` 真的从 `token` 变成 `cloud`。

此前该缺陷的表现是：提案显示通过、但主表分类不变（静默失败）。

---

## 二、R2 占位数据：116 条全部待清洗

```
总 bp- 行数: 116
  status=pending : 116   ← 前台一条都不展示（已验证公开 total 仍为 10）
  quality=中品   : 116   ← 占位值，非核验结论
  expires_at=NULL: 116   ← 未标注
  real_name 空   : 116   ← 未标注
  featured=0     : 116
  有 source_url  : 116   ← 运营留痕，公开侧零泄漏（已用这 116 条做夹具验证）
```

**12 条没有官网**（对方直发 Base64 Key/Token，无官网可抽），`url` 回落成对方详情页。
清单见 [bp-channels-todo.md](bp-channels-todo.md)。

> 这 12 条的性质与本站「可领取的免费额度」**不同** —— 是公开共享的 Key 池。
> 建议驳回或找真实官网，**不要原样发布**。

已额外核查：**0 条 id 畸形**（全部符合 `bp-<slug>` 规范）。

---

## 三、R3 发货检查清单

见 [2026-11-04-ship-checklist.md](2026-11-04-ship-checklist.md)，含：
提交前排除他人改动、`server/data/` vs `data/` 的 gitignore 区分、bump VERSION 规则、
**「推送后不要 pull」的部署坑**、迁移幂等性、回滚锚点、发布后 5 项自检、已知遗留。

---

## 四、R4 全量回归：全绿

| 项 | 结果 |
|---|---|
| `pnpm ts:check` | **298 个 .ts 文件，911 个具名导入全部解析** |
| `bash /tmp/nb.sh` | `BUILD_EXIT=0`，产物 13:54:02 |
| `/` `/tokens` `/tokens/api` `/tokens/server` `/tokens/domain` `/tokens/compare` | **全部 200**（26951 / 53142 / 53092 / 21238 / 21296 / 15898 bytes） |
| 公开列表 `total` | **10**（未泄漏任何 pending） |
| `bp-` 直接访问 | `/api/token-deals/bp-…` → **404**；`/tokens/bp-….html` → **404** |
| `public-field-matrix.mjs` | **16 通过 / 0 失败 / 1 跳过** |

`public-field-matrix` 用的夹具是**真实库 + 116 条带 `source_url` 的 pending 行** ——
比造合成数据更能证明「字段有值但不下发」。

---

## 五、验证工具本身也做了反向验证

新脚本若只会报绿，等于没验证。所以：

1. **不传 dbPath** → 明确警告「落库断言将跳过」，结果降到 12 通过（**不伪造通过数**）
2. **指向不存在的服务** → `fetch failed` 明确异常退出（**不静默成功**）

---

## 六、待人工决策的两件事

### 6.1 PUT 全量替换是否需要改语义

**现状**：PUT 是全量替换，漏传 `faq`/`summary` 会被清空。

- **UI 无风险**：`TokenDealEditor.vue` 的 `currentPatch()` 遍历 `PATCHABLE` 发送全部字段（已核）。
- **风险面**：任何**不走编辑器的调用方**（脚本、第三方集成、旧版客户端）只发 `title` 时，
  会连带清空 FAQ/摘要/限制，且**没有任何报错**。

**建议**：暂不改。理由是全量替换与既有 `invite-codes` 端点语义一致，改成 PATCH 语义会引入
「传空字符串是想清空、还是没传」的歧义。若要改，应做成显式 `PATCH` 方法而非改 PUT 行为。
这条**留给产品决策**，我不单方面改动。

### 6.2 `featured` 无数量上限

谁都能勾多条进 `/tokens/compare`。属运营策略，未擅自加限制。

---

## 附录：复跑方式

```bash
# 1. 准备库副本 + 测试账号
TD=/tmp/lead-verify-$(date +%H%M%S); mkdir -p $TD
cp data/favshub.db $TD/test.db
node -e "
const D=require('./node_modules/better-sqlite3'), b=require('./node_modules/bcryptjs');
const db=new D('$TD/test.db'), pw=b.hashSync('verify-pass-123',10);
for(const [u,n,a] of [['vr_admin','验证管理员',1],['vr_user','验证用户',0]])
  db.prepare('INSERT INTO users (username,email,password_hash,nickname,is_admin,created_at) VALUES (?,?,?,?,?,?)').run(u,null,pw,n,a,Date.now());
"

# 2. 起构建产物（私有副本，避免与 dev 抢 .output）
OUT=/tmp/verify-out-$(date +%H%M%S); cp -r .output $OUT
cd $OUT && NUXT_DB_PATH=$TD/test.db PORT=3311 node server/index.mjs &

# 3. 跑验证
cd - && node scripts/verify-admin-flow.mjs http://127.0.0.1:3311 $TD/test.db
```