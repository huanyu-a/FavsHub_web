# tokenhub 本地预览站视觉与字段规范（对齐 FavsHub）

> 目的：把 `local_server.py`（127.0.0.1:8018 只读预览站）的四个页面重做得与用户自己的 FavsHub 站视觉统一、字段语义正确。
>
> 权威来源：`D:/project/wwwroot/FavsHub_web/favshub-nuxt`（Nuxt 3 + Vue 3）工作区现状（main 分支，含用户未提交的前端修改，2026-09-29 勘察；`TokenShareSheet.vue`、`UserPanel.vue` 等有未提交改动，均以工作区文件为准）。FavsHub 仓库全程只读。
>
> 图标说明：FavsHub 使用 Remix Icon 图标字体（`public/vendor/remixicon.css:11-15` 的 `@font-face "remixicon"`），模板中以 `<i class="ri-xxx-line">` 引用。本地单文件预览不引外部字体时，用「同义 Unicode 符号 / 文字标签」替代（见 §4.3）。

---

## 一、设计变量

### 1.1 主题机制（理解后再抄值）

FavsHub 的语义变量全部用 CSS 原生 `light-dark()` 定义，靠 `color-scheme` 自动切换明暗（`favshub-nuxt/public/css/tokens.css:55` `color-scheme: light dark;`；加载顺序 tokens.css → themes.css → main-bundle.css，见 `tokens.css:17` 与 `layouts/default.vue:76-79`）。

- 默认浅色主题 = 「暖灰白 theme-bg-7」：只改背景，其余继承 `:root`（`themes.css:87` 注释）。
- 默认深色主题 = 「墨夜 theme-bg-mo-ye」：完全继承 `:root`（`themes.css:182` 注释）。
- 强调色默认翠绿 Emerald（`tokens.css:57` 注释），另有 11 套可选主题（`themes.css:1-269`），本地预览**不需要**做主题切换器。

### 1.2 配色总表（浅色值 / 深色值，出处均为 `favshub-nuxt/public/css/tokens.css`）

| 变量 | 浅色 | 深色 | 用途 | 出处 |
|---|---|---|---|---|
| `--primary` | `#059669` | `#34D399` | 主色（按钮、active、链接） | tokens.css:58 |
| `--primary-hover` | `#047857` | `#10B981` | 主色悬停 | tokens.css:59 |
| `--primary-dark` | `#065F46` | `#059669` | 主色按下 | tokens.css:62 |
| `--primary-light` | `rgba(5,150,105,0.08)` | `rgba(52,211,153,0.12)` | 主色软底（active 项底、焦点光环） | tokens.css:60 |
| `--primary-medium` | `rgba(5,150,105,0.15)` | `rgba(52,211,153,0.2)` | 主色中底 | tokens.css:61 |
| `--surface`（页面底） | `#F8F7F4` | `#0F172A` | body 背景 | tokens.css:65, 136-140 |
| `--surface-raised`（卡片） | `#FCFBF9` | `#1E293B` | 卡片/弹窗/按钮底 | tokens.css:66 |
| `--surface-sunken`（凹陷块） | `#F1F0EC` | `#0B1120` | 次级块底（chip、fact、代码底） | tokens.css:67 |
| `--surface-hover` | `#F5F5F0` | `rgba(51,65,85,0.6)` | 悬停底 | tokens.css:68 |
| `--surface-active` | `#E5E5E0` | `rgba(71,85,105,0.8)` | 按下底 | tokens.css:69 |
| `--surface-selected` | `rgba(5,150,105,0.10)` | `rgba(52,211,153,0.15)` | 选中底 | tokens.css:70 |
| `--sidebar-bg` | `rgba(252,251,249,0.95)` | `rgba(15,23,42,0.95)` | 侧栏底 | tokens.css:71 |
| `--text-primary` | `#1F2937` | `#E2E8F0` | 主文字 | tokens.css:74 |
| `--text-secondary` | `#4B5563` | `#94A3B8` | 次文字 | tokens.css:75 |
| `--text-tertiary` | `#9CA3AF` | `#64748B` | 弱文字（标签、占位、时间） | tokens.css:76 |
| `--text-inverse` | `#ffffff` | `#0F172A` | 反色文字（实底徽标上） | tokens.css:77 |
| `--text-quaternary` | `#D1D5DB` | `#475569` | 第四级弱化文字 | tokens.css:116 |
| `--border` | `rgba(31,41,55,0.08)` | `#334155` | 边框（卡片用 0.5px 细边） | tokens.css:80 |
| `--border-focus` | `rgba(79,70,229,0.4)` | `rgba(96,165,250,0.4)` | 聚焦边框 | tokens.css:81 |
| `--divider` | `rgba(31,41,55,0.06)` | `rgba(255,255,255,0.06)` | 分割线（0.5px） | tokens.css:82 |
| `--overlay` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.6)` | 弹窗遮罩 | tokens.css:94 |
| `--backdrop-blur` | `blur(20px)` | 同左 | 遮罩模糊 | tokens.css:95 |
| `--accent-blue` | `#3B82F6` | `#60A5FA` | 强调蓝（info） | tokens.css:98 |
| `--accent-purple` | `#764ba2` | `#a78bfa` | 强调紫 | tokens.css:99 |
| `--accent-red` | `#EF4444` | `#F87171` | 强调红 | tokens.css:100 |
| `--accent-yellow` | `#F59E0B` | `#FBBF24` | 强调黄 | tokens.css:101 |

状态色（独立于主题，`tokens.css:103-106`）：

| 变量 | 浅色 | 深色 | 语义 |
|---|---|---|---|
| `--success` | `#10B981` | `#3FB950` | 有效/还能用/通过 |
| `--danger` | `#EF4444` | `#F85149` | 失效/错误/驳回 |
| `--warning` | `#F59E0B` | `#D29922` | 待定/即将过期/低品质 |

软底（由状态色派生，`tokens.css:109-113`）：`--danger-soft` = danger 10% 混 surface-raised；`--warning-soft` = warning 15% 混透明；`--success-soft` = success 12% 混透明；`--info-soft` = accent-blue 12% 混透明；`--neutral-soft` = text-tertiary 12% 混透明。徽标一律「软底 + 同色文字」。

### 1.3 圆角 / 阴影 / 间距 / 过渡

- 圆角档位：`--radius-sm: 8px`、`--radius-md: 12px`、`--radius-lg: 16px`、`--radius-xl: 20px`（tokens.css:119-122）。**实际组件另有两个高频值**：
  - 卡片/弹窗外壳 `14px`（`TokenDealCard.vue:181`、`TokenDealDetail.vue:1275`、骨架卡 `pages/tokens/index.vue:650`）；
  - 内嵌件（quota 块、按钮、fact 块、toast、搜索框）`10px`（`TokenDealCard.vue:339`、`TokenDealDetail.vue:1904`、`pages/tokens/index.vue:525`）；小徽标/chip/图标块 `6px`（`TokenDealCard.vue:262,361`）。
- 阴影：`--shadow-color` 浅 `rgba(15,23,42,0.07)` / 深 `rgba(0,0,0,0.42)`（tokens.css:87）；四档：sm `0 1px 3px`、md `0 4px 12px`、lg `0 12px 40px`、xl `0 20px 60px`（tokens.css:88-91）。卡片静默无边框阴影、悬停才给 `--shadow-md`（`TokenDealCard.vue:185-189`）。
- 间距：页面 `max-width: 1200px; margin: 0 auto; padding: 24px`（`pages/tokens/index.vue:472-476`）；卡片网格 `repeat(auto-fill, minmax(300px, 1fr)); gap: 16px`（`pages/tokens/index.vue:629-634`）；hero 面板 `padding: 20px 24px; margin-bottom: 20px`（`pages/tokens/index.vue:480-491`）；卡片内 `padding: 16px; gap: 10px`（`TokenDealCard.vue:174-177`）；区段间距 16px（`TokenDealDetail.vue:1431`）。
- 过渡：统一 `0.18s cubic-bezier(0.22, 1, 0.36, 1)`（tokens 组件，如 `TokenDealCard.vue:183`）；bundle 内部分用 `120ms/180ms` 同曲线（`main-bundle.css:5878`）。焦点态一律 `outline: 2px solid var(--primary); outline-offset: 2px`（如 `TokenDealCard.vue:194-197`）。

### 1.4 字体与字号

- 字体栈：`--font-system: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`（tokens.css:125）；body 实际生效的是 `main-bundle.css:795-796` 的 `system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif, …`；等宽 `--font-mono: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace`（tokens.css:126），用于代码/key 脱敏串（`TokenDealDetail.vue:1468-1476`）。
- 字号阶梯（tokens 页实测）：
  - 页面 hero 标题 `20px/700, letter-spacing:-0.02em`（`pages/tokens/index.vue:496-502`）
  - 弹窗标题 `17px/600`（`TokenDealDetail.vue:1406-1412`）
  - 顶栏站点标题 `15px/600`（`pages/tokens/index.vue:426-432`）；弹窗内厂商名 `15px/600`（`TokenDealDetail.vue:1312-1320`）
  - 正文/卡片标题 `14px/500, line-height:1.5`（`TokenDealCard.vue:326-332`）
  - 导航链接、按钮、厂商名、quota 值 `13px`（`pages/tokens/index.vue:439-450`、`561-575`；`TokenDealCard.vue:237-245,347-351`）
  - 徽标、chip、meta、统计行 `12px`（`TokenDealCard.vue:251-255,358-368,381-386`）
  - 最弱级（fact 标签、时间戳、字数）`11px`（`TokenDealDetail.vue:1428,1681,1626`）
- 数字用 `font-variant-numeric: tabular-nums`（分页页码 `pages/tokens/index.vue:730-734`、Nexus 统计 `TokenDealCard.vue:314-320`）。

### 1.5 导航栏样式（照抄结构）

**模式 A：独立频道页顶栏（tokens 页 / collections 页同款，本地预览照这个抄）**——`pages/tokens/index.vue:384-470`（collections 版在 `main-bundle.css:5850-5937`，值一致）：

- 外壳：`background: var(--surface); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 100`（tokens/index.vue:384-391）。
- 内条：`max-width: 1200px; margin: 0 auto; padding: 0 24px; height: 52px;` 左右两端对齐（tokens/index.vue:392-402）。
- 左侧：logo 图 26×26（圆角 6px，hover 透明度 0.7）+ 标题 `15px/600`，间距 12px（tokens/index.vue:403-432）。
- 右侧菜单项：`display:flex; gap:5px; padding:6px 10px; border-radius:6px; font-size:13px; font-weight:500; color:var(--text-tertiary)`，图标 15px、透明度 0.7；hover 底 `--surface-hover` + 字变 `--text-primary`；**active = 主色文字 + `--primary-light` 底**（tokens/index.vue:439-470）。菜单五项：主页 / 精选集 / 白嫖通告 / 提示词 / 评测看板，每项带 16px 线性 SVG 图标（tokens/index.vue:11-33）。
- 本地映射：菜单改为「概览 / Key 快照 / 人工队列 / 日报 / feed.xml」，左标题用「🔒 TokenHub 本地预览」之类文案，图标降级见 §4.3。

**模式 B：主页侧边栏（仅作气质参考，本地不必复刻）**：`aside.custom-width` 背景 `--sidebar-bg`、右边框 1px `--border`、内边距 1rem（`main-bundle.css:1221-1225`），宽 20rem（折叠 `margin-left:-20rem`，`main-bundle.css:1213-1214`）。品牌卡：logo 42×42、padding 8px、圆角 12px、底 `--primary-light`，站名 `16px/700`，副题 `11px` 大写、字距 0.08em（`main-bundle.css:1270-1300`）。频道导航：容器底 `--surface-hover`、圆角 14px、内衬 0.22rem，项圆角 12px、`min-height:36px`、`12px/700`，active = `--surface-raised` 底 + 投影（`main-bundle.css:1302-1351`）。

**用户区**（侧栏底部，`components/sidebar/UserPanel.vue:493-533`）：头像 28×28 圆形、底 `--primary`、反色首字母 `12px/600`；名字 `13px/500` 截断；容器 hover 底 `--surface-hover`、圆角 6px。本地预览无登录体系，**可省略或替换为「只读 · 本地数据」静态徽标**，不必复刻菜单。

---

## 二、tokens 页字段清单

### 2.1 卡片字段（`components/tokens/TokenDealCard.vue`，模板 1-80 行）

卡片自上而下五段（头部 / Nexus 条 / 标题 / 额度 / 模型 chips + 底部统计）：

| 字段 | 语义 | 显示格式 | 空值占位 | 出处 |
|---|---|---|---|---|
| `provider` | 厂商名 | 卡片头首行，`13px/500` 主文字色，超长省略号；置顶时尾随 `ri-pushpin-2-fill` 图钉（11px 主色） | 图标 fallback 取首字符大写，无则 `?`（118 行） | TokenDealCard.vue:24-27, 118, 237-245 |
| 厂商图标 | 站点 favicon（`fallbackProxyIcon(url)`） | 28×28、圆角 6px、底 `--surface-sunken`、内描边 `inset 0 0 0 1px var(--border)`；加载失败回退首字母色块 | 首字母大写色块（fallback 同尺寸） | TokenDealCard.vue:14-22, 217-233 |
| `region` | 地区 | 与 source_tag 拼成 meta 行 `国内直连 · 官方直营`（`·` 分隔，12px tertiary） | 缺省 `cn`→「国内直连」 | TokenDealCard.vue:28, 108-119 |
| `source_tag` | 来源 | `official`官方直营 / `relay`中转站 / `community`社区转发；缺省 official | — | TokenDealCard.vue:109-120 |
| `quality` | 品质五档徽标 | 右上角 `12px`、`padding:2px 8px`、圆角 6px；配色见 §3.1；缺省按「中品」 | 无 quality → `中品` | TokenDealCard.vue:31, 122-131, 257-282 |
| `nexus` | 实测接入状态条 | 见 §3.2；`12px`，tag `padding:2px 7px` 圆角 6px；统计数字 tabular-nums | 未接入 → 灰 tag「未接入 Nexus」 | TokenDealCard.vue:34-54, 292-324 |
| `title` | 通告标题 | `14px/500, line-height:1.5`，主文字色，可换行不截断 | 必填，无占位 | TokenDealCard.vue:56, 326-332 |
| `quota` | 免费额度 | 额度块：软主色底（primary 6% 混 surface-sunken）+ 左侧 3px 主色竖条，圆角 10px；label「免费额度」12px tertiary、值 13px/500 主文字色 | quota 为空→整块不渲染（`v-if`） | TokenDealCard.vue:58-61, 334-351 |
| `models` | 支持模型 | chips：`12px`、`padding:2px 7px`、圆角 6px、底 `--surface-sunken` 字 secondary；**最多显示 3 个**，余量 `+N` 灰 chip（is-more） | 空数组→整行不渲染 | TokenDealCard.vue:63-66, 147-148, 353-371 |
| `vote_up` | 「还能用」票数 | 底部统计行（上 0.5px divider 分隔）：绿拇指 + 数字，12px success 色 | 数字照实显示（默认 0） | TokenDealCard.vue:69-71, 392-394 |
| `vote_down` | 「已失效」票数 | 红拇指 + 数字，12px danger 色 | 同上 | TokenDealCard.vue:71, 395-397 |
| `rating_sum/rating_count` | 综合评分 | 平均分 `round(sum/count,1)` 一位小数，金星 + 数字，12px warning 色；count=0 → 灰字「暂无评测」 | 「暂无评测」 | TokenDealCard.vue:72-75, 150-154, 398-403 |
| `expires_at` | 到期提示 | 右下角 12px：剩 ≤30 天 → `N 天后到期`；≤0 → `已过期`；>30 天或不填 → 不显示；剩 ≤3 天加 `is-warn`（warning 色） | 空则不渲染 | TokenDealCard.vue:77, 156-170, 404-410 |
| `pinned` | 置顶 | 卡片边框混主色 55% + 160° 主色渐变底（6% 混 raised）+ 头部图钉 | — | TokenDealCard.vue:198-201, 26 |
| `is_expired` | 已失效 | 整卡 `opacity: 0.6` | — | TokenDealCard.vue:202-204 |

卡片外壳：`surface-raised` 底 + `0.5px solid var(--border)` 边 + 圆角 14px；hover 变 `--border-focus` 边 + `--surface-hover` 底 + `--shadow-md`；active `--surface-active`（TokenDealCard.vue:174-193）。

### 2.2 详情弹窗补充字段（`components/tokens/TokenDealDetail.vue`）

- 头部：图标 36×36 圆角 10px（1296-1303）；厂商名 15px/600；meta 行 `地区 · 来源 · 到期文案`，已过期文字 warning 色（1326-1331）；右上品质徽标 + 关闭钮（28×28 圆角 6px）。
- 审核状态条（51-58、1391-1404）：`pending` → warning 10% 底 + warning 字「待审核」；`rejected` → danger 10% 底「未通过审核」+ 驳回原因。
- 关键信息三宫格 `tdd-facts`（63-76、1414-1429）：`grid; repeat(auto-fit, minmax(140px,1fr)); gap:12px`，每格 12px padding、圆角 10px、底 `--surface-sunken`；label 11px tertiary / value 13px。**空值占位**：quota 空→「未说明」、发布者空→「匿名」（66, 74）。
- 到期文案完整逻辑（791-800）：无值→「永久有效」；已过期→「已过期」；剩 ≤1 天→「今天到期」；≤30 天→`N 天后到期`；>30 天→`toLocaleDateString('zh-CN')`。
- 接入信息（79-90、1443-1480）：「领取地址」行 = 64px 宽灰色 label + 主色链接（超长省略）；「API 地址」行 = 等宽字体 `<code>`（`--font-mono` 12px、`--surface-sunken` 底、`padding:3px 7px`、圆角 8px）+ 复制钮。
- 模型 chips（93-98、1482-1489）：同卡片但 `padding:3px 8px`、全量展示。
- 备注（100-104、1490-1496）：13px/1.65 secondary，`white-space: pre-wrap`。

### 2.3 过滤栏选项（`components/tokens/TokenFilterBar.vue`）

- 排序 tabs（胶囊组，49-55）：`Nexus 实测(nexus) / 最新(latest) / 最热(hot) / 高分(rating) / 即将过期(expiring)`。
- 品质下拉（58）：`上上品 / 上品 / 中品 / 下品 / 下下品`；来源下拉（59-63）：`官方直营 / 中转站 / 社区转发`。
- 样式：胶囊组容器底 `--surface-sunken` 圆角 10px 内衬 4px，选中项 `--surface-raised` 底 + 主色字 + sm 阴影（73-119）；下拉框 `12px`、圆角 10px、0.5px 边（125-143）。

### 2.4 时间格式化规则

- 唯一格式化函数 `formatTime`：**`YYYY-MM-DD`**（`TokenDealDetail.vue:810-814`，补零）。时间戳用毫秒（与 `Date.now()` 直接相减，`TokenDealCard.vue:159`）。
- 相对语义优先：到期只剩「已过期 / 今天到期 / N 天后到期 / 永久有效」（TokenDealDetail.vue:791-800）；评测、建议时间用绝对 `YYYY-MM-DD`。
- ⚠️ **本地库是秒级时间戳**（实测 `token_keys.first_seen_at=1790576743` → 2026-09-28 14:25），移植时注意换算（Python 侧 `datetime.fromtimestamp()` 直接可用；勿照抄毫秒逻辑）。

### 2.5 本地 `token_keys` → 卡片字段映射（数据红线内）

本地 schema 见 `crawler/data/tokenhub.db`（`token_keys` 22 行 = 1 条 `source='post'` 真 key + 21 条 `source='reply_visible_guide'` 回帖解锁指引，实测于 2026-09-29）：

| FavsHub 卡片字段 | 本地来源列 | 映射建议 |
|---|---|---|
| provider 图标/首字母 | `provider`（常为空，实测 sample 为 `''`）/ `base_url` 域名 | provider 空时取 base_url 域名主体作显示名，首字母 fallback 保留 |
| meta 行（地区·来源） | `source_id` + `source` | `source='reply_visible_guide'` →「回帖解锁指引」，`post` →「帖子直提取」；不建议照抄「官方直营」语义（本地无该维度） |
| 品质徽标 | `confidence`（high/medium/low） | 不冒充 FavsHub 五档品质；用「置信」徽标（high=success 软底 / medium=warning / low=neutral），文案「置信 · 高」 |
| quota 额度块 | `key_masked`（真 key）或「🔒 回帖解锁指引」 | 真 key 用等宽字体展示 `sk-NoN***…jlgs` 形态（前缀+星号+后缀，脱敏已入库）；C 类帖显示 🔒 + 原帖链接，**绝不渲染 `key_encrypted` / `key_hash`** |
| models chips | `models`（JSON 数组） | 解析后照 chips 渲染，超 3 个 `+N` |
| 投票/评分 | 无 | 不渲染（本地无社区数据），footer 换成 verdict 徽标 + 探测时间 |
| expires_at | `last_probe_at` / `first_seen_at`（秒级） | footer 右侧「探测 YYYY-MM-DD」（无则「发现 YYYY-MM-DD」，再无则 `—`） |
| title | `source_title` | 卡片主标题；空则回退 `source_url`（现 render_keys 已有此逻辑） |
| 详情「领取地址」 | `source_url` | 链接行照 §2.2 样式 |
| — | `verdict` / `deal_status` | 徽标见 §3.7；deal_status 目前全部 `published`，可不作徽标 |

---

## 三、状态与徽标惯例

FavsHub 的惯例是：**徽标 = 软色底（状态色 8%~15% 透明度，或 sunken 底）+ 同色文字，小圆角（6px），12px 字**；纯实底只给最高档与计数角标用。

### 3.1 品质五档徽标（`TokenDealCard.vue:257-282`；详情版 `TokenDealDetail.vue:1339-1347`）

| 档位 | 类名 | 卡片版 | 详情弹窗版 |
|---|---|---|---|
| 上上品 | `q-top` | **实底**：`--primary` 底 + `--text-inverse` 字、`font-weight:600` | 同 `q-high`（primary-light 底 + 主色字） |
| 上品 | `q-high` | `--primary-light` 底 + `--primary` 字、600 | 同左 |
| 中品 | `q-mid` | `--surface-sunken` 底 + `--text-secondary` 字 | 同左 |
| 下品 / 下下品 | `q-low`/`q-bottom` | `color-mix(warning 12%, transparent)` 底 + `--warning` 字 | 同左 |

### 3.2 Nexus 接入状态条（`TokenDealCard.vue:34-54, 292-324`）

- 已接入可用（`nexus.enabled`）：`nexus-tag` = `--primary-light` 底 + `--primary` 字 + 脉搏图标，文案「Nexus 实测」；后随统计 `8/10`（成功率）与 `1.2s/850ms`（`ms>=1000` 取一位小数秒，否则毫秒，`TokenDealCard.vue:134-145`）。
- 已禁用：warning 12% 底 + warning 字「Nexus 已禁用」。
- 未接入：`--surface-sunken` 底 + tertiary 字、`font-weight:400`「未接入 Nexus」。

### 3.3 投票 / 评分语义色（`TokenDealCard.vue:392-403`）

「还能用」= `--success`；「已失效」= `--danger`；星级评分 = `--warning`；无评测 = tertiary 灰字。详情弹窗投票按钮激活态：边框 success/danger 实色 + 状态色 8% 透明底（`TokenDealDetail.vue:1521-1524`）；星级条 `ri-star-fill` warning 色（`TokenDealDetail.vue:1546`）。

### 3.4 到期 / 时间警示

- 即将到期（≤3 天）与已过期文字：`--warning`（`is-warn`，`TokenDealCard.vue:408-410`；详情 meta 行 `TokenDealDetail.vue:1331`）。
- 星级分布条：6px 高、999px 圆角轨道（`--surface-sunken`）+ warning 填充（`TokenDealDetail.vue:1563-1576`）。

### 3.5 审核 / 生命周期状态（`TokenDealDetail.vue:1391-1404, 1797-1809`）

- 待审核 `pending`：warning 10% 底 + warning 字 + 时钟图标。
- 已驳回 `rejected`：danger 10% 底 + danger 字；小徽标变体用 danger 描边 + danger 字（`guest-badge.rejected`）。

### 3.6 计数角标

「待我审核」数量角标（`pages/tokens/index.vue:615-627`）与待审建议计数（`TokenDealDetail.vue:1994-2006`）：**danger 实底 + 反白字、圆角 999px、`min-width:16px`、字号 11px、`font-weight:700`**。

### 3.7 本地 verdict → 徽标映射建议（沿用 §3 惯例）

现有 `local_server.py:29-39` 的 `VERDICT_CLASS`（ok/warn/bad/muted）语义正确，重做时按 FavsHub 惯例换肤即可：

| verdict | 类 | 底色 | 字色 | 对应 FavsHub 语义 |
|---|---|---|---|---|
| `valid` | ok | `--success-soft`（success 12%） | `--success` | 「还能用」绿 |
| `limited` / `quota_exceeded` / `restricted` / `blocked_by_waf` | warn | `--warning-soft`（warning 12%） | `--warning` | 待定/受限黄 |
| `dead` | bad | `--danger-soft`（danger 10%） | `--danger` | 「已失效」红 |
| `unknown` / `endpoint_unsupported` | muted | `--neutral-soft`（tertiary 12%） | `--text-tertiary` | 「未接入」灰 |
| `confidence: high/medium/low` | — | success/warning/neutral 同上 | 同上 | 「置信」徽标 |
| `source: reply_visible_guide` | guide | `--info-soft`（accent-blue 12%） | `--accent-blue` | 信息类蓝（本地特有，替换现在的紫色 `.guide`） |

徽标 CSS 模板：`display:inline-flex; align-items:center; gap:3px; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:500;`；文字照实输出英文原值（valid/dead…）或中文「有效/失效/待定」皆可，但同页统一。

---

## 四、移植要点（单文件 Python + 内联 CSS，无 Vue / 无构建）

### 4.1 为什么能近乎 1:1

FavsHub 的 tokens 页面**没有用任何 CSS 框架**：`package.json` 依赖里无 Tailwind/UnoCSS（实测 dependencies 仅 nuxt/vue/naive-ui 等，2026-09-29），tokens 页全部样式是手写 scoped CSS + CSS 变量（`pages/tokens/index.vue:383-802`、`TokenDealCard.vue:173-411`），组件库 naive-ui 也未在这组组件中出现。因此把变量表（§1.2）+ 关键规则抄进 `local_server.py` 的 `STYLE` 字符串，视觉即可对齐。

### 4.2 可 1:1 复刻（纯静态 CSS，无 JS 依赖）

1. **变量层**：把 §1.2 表写成 `:root { … }`，深色用 `@media (prefers-color-scheme: dark) { :root { … } }` 双写覆盖（见 4.3 第 1 条降级）。
2. **顶栏**：§1.5 模式 A 整套（sticky、52px、菜单 active 态）——`local_server.py` 现在的深色 `nav` 条（`local_server.py:43-45`）整段废弃。
3. **hero 页头**：raised 面板 + 标题/副文 + 右侧工具区（预览站无搜索/发布，可放「数据截止时间」「刷新即最新」等静态说明文字）。
4. **卡片网格**：`grid; repeat(auto-fill, minmax(300px,1fr)); gap:16px` + 卡片外壳五段结构（头部/状态条/标题/额度块/统计行），额度块直接改造为「脱敏 key 等宽块」（左 3px 主色竖条 + sunken 底的版式保留）。
5. **徽标 / chips / 统计卡**：§3 全套软底徽标、`tdd-facts` 三宫格（概览页统计直接用它）。
6. **表格换肤**（queue/reports 若保留表格）：表头 `--surface-sunken` 底 12px tertiary 字、行分隔 0.5px `--divider`、行 hover `--surface-hover`、单元格 13px；去现有实线方框边（`local_server.py:48-50`）。
7. **空状态**：虚线边框 raised 面板 + 36px 图标位 + 两行文案（`pages/tokens/index.vue:673-697`）——本地数据恒有，可留作 404/目录空样式。
8. **toast/弹窗遮罩**等如需静态化说明条，配色照 §1.2。

### 4.3 需要降级 / 舍弃的

1. **`light-dark()` 与主题系统**：`light-dark()` 需浏览器支持且靠 `color-scheme` 切换；单文件预览建议降级为「`:root` 浅色值 + `@media (prefers-color-scheme: dark)` 覆盖同批变量」，跟随系统、无切换器（11 套主题、`data-theme` 属性、UserPanel 的外观菜单全弃）。
2. **Remix Icon 字体**：不引外部 woff2。降级方案：状态点用 CSS 圆点（`width:8px;height:8px;border-radius:50%;background:var(--success)`）或 Unicode（🔒 ⚠ ✕ ↗ ·）；图标语义用文字保留（如「探测」替代雷达图标）。FavsHub 图标仅作装饰性补充，语义都在文字里，降级不损信息。
3. **交互**：搜索防抖、排序/筛选联动、投票、弹窗（`TokenDealDetail` 680px 居中 + `88vh` 内滚 + 遮罩 blur）、分享卡、分页按钮——预览站全部静态化：筛选可用无 JS 的 `<details>` 折叠或干脆不提供；弹窗内容直接平铺进 keys 卡片（本地无隐私扩面风险，字段同 §2.5）。
4. **骨架屏 shimmer / View Transitions / backdrop-filter**：可留 CSS 动画但无加载场景，直接省；`backdrop-filter: blur(20px)` 仅弹窗遮罩用，静态化后弃。
5. **移动端**：FavsHub 有完整断点（768px 单列网格 `pages/tokens/index.vue:787-792`、640px 弹窗贴底 `TokenDealDetail.vue:2139-2151`）。预览站保留两条最便宜的即可：`max-width:768px` 时网格单列 + 页面 padding 收窄；其余移动断点可弃。
6. **深色 shadow 变量**：注意 FavsHub 深色阴影是双色逗号串（`themes.css:172-175`），简化为单色 `rgba(0,0,0,0.42)` 四档即可（`tokens.css:87-91` 默认值本来如此）。

### 4.4 本地四页布局建议

统一骨架：顶栏（§1.5 模式 A，菜单=概览/Key 快照/人工队列/日报/feed.xml）→ hero 说明条 → 内容区 → 页脚 note（保留现有「明文 key 绝不出库 07 §8.5」提示，样式用 12px tertiary）。

| 页面 | 布局 | 理由与要点 |
|---|---|---|
| `/` 概览 | **统计卡网格（tdd-facts 放大版）+ 水位表格** | 四个统计（已提取 key / 回帖指引 / 队列待复核 / 已判失效）用 `tdd-facts` 版式：sunken 底圆角 10px，label 11px tertiary、数值 20px/700（参考 `score-num`，`TokenDealDetail.vue:1544`）；水位（crawl_state）数据量小（每源一行），用换肤表格或两张小卡。 |
| `/keys` Key 快照 | **卡片网格（deal-card 变体）** | 22 条规模正适合 `minmax(300px,1fr)` 网格。卡头：首字母色块 + 显示名（provider 或 base_url 域名）+ meta 行「来源 · 置信徽标」；主标题 = source_title；额度块位 = key_masked 等宽块（B 类）或 🔒 回帖解锁指引条 + 原帖链接（C 类，info-soft 蓝）；模型 chips 照抄；底部统计行 = verdict 徽标（§3.7）+「探测 YYYY-MM-DD」。已判失效卡 `opacity:0.6` 对齐 `is-expired`。 |
| `/queue` 人工队列 | **表格（不换卡片）** | 200 条运营清单，行式扫读效率高于卡片；按 §4.2 第 6 条换肤，列保持时间/原因/详情/来源帖/状态；`reason` 用 §3.7 徽标化（low_confidence_classify 灰、suspected_valuable_E 蓝、card_or_paid_benefit_info 黄、unknown_5_rounds 红，实测分布 91/40/68/1）；`status=pending` 用 warning 徽标。 |
| `/reports/`（目录） | **目录列表卡（轻量）** | 静态文件目录，沿用 `<ul>` 但每行加 `--divider` 分隔 + hover 底色；文件名等宽字体；无需卡片网格。feed.xml 入口放顶栏菜单。 |
| 404 / 空态 | 虚线空状态面板 | §4.2 第 7 条。 |

### 4.5 数据红线（重做时必须保持，出自任务约束 07 §8.5）

- 页面绝不输出 `key_encrypted`、`error_message_raw`、`key_hash`（`local_server.py` 现有查询未取这些列，重做时同样不取）。
- key 只以 `key_masked`（前缀+星号+后缀，实测样例 `sk-NoN*****************************************jlgs`）展示；所有动态文本先过 `scrub()`（`local_server.py:72-74`）再 `html.escape`（`local_server.py:77-78`），顺序不可反。
- 站点只绑 `127.0.0.1`（`local_server.py:26`）。

---

## 自查：色值/字段出处核对表

- 所有 `light-dark()` 双值：`favshub-nuxt/public/css/tokens.css:54-127`（:root 实值），`themes.css` 仅主题覆盖、默认主题继承 ：root（themes.css:87, 182 注释）。
- 阴影：tokens.css:87-91；遮罩/模糊 tokens.css:94-95；圆角 tokens.css:119-122；字体 tokens.css:125-126 与 main-bundle.css:795-796。
- 顶栏：pages/tokens/index.vue:384-470（tokens 版），main-bundle.css:5850-5937（collections 共享版，数值一致）；侧栏 main-bundle.css:1221-1368；用户区 UserPanel.vue:489-533。
- 卡片：TokenDealCard.vue:174-411；字段语义 82-170；详情 TokenDealDetail.vue:1-580（模板）、1250-2152（样式）、685-814（label 表/到期/时间格式化）；过滤栏 TokenFilterBar.vue:49-63（选项）、72-154（样式）。
- collections 气质：pages/collections/index.vue:202-325（hero/网格与 tokens 同款）；主页气质：pages/index.vue:425-521（胶囊 tabs 与 filter-tab 同款）、侧边栏布局 1-25。
- 本地 DB 字段与值分布：2026-09-29 以 `python -c sqlite3 (mode=ro)` 实测（verdict 全 unknown、source 1 post + 21 reply_visible_guide、confidence 21 high + 1 medium、queue 200 条 pending 四类 reason、mask 样例、秒级时间戳）。
- 无 CSS 框架结论：实测 `favshub-nuxt/package.json` dependencies（无 tailwind/unocss）。

文档完。以上即重做 `local_server.py` 四页所需的全部视觉常量与字段语义。
