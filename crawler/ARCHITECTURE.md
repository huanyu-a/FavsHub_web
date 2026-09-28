# tokenhub crawler — 架构与接口契约（P0-1 骨架）

本文件是四位并行实现同事的**唯一契约来源**。开工前完整读一遍；每次想改
`interfaces.py` 里的东西之前，先回到这里确认边界。

- 权威方案：`docs/07-最终执行方案.md`（§四 流程、§5.1/5.2 任务与目录、§5.4 验收、
  §8.1–§8.5 技术规格）。本文件逐字引用 07 的编号，**不复述**、不凭记忆改写。
- 证据语料：`docs/02-前期侦察实测证据.md`。`crawler/fixtures/` 里的串全部可回溯到 02
  的 A/B/D 小节；正则常量在 `interfaces.py` 中与 07 §8.1/§8.2 逐字对齐。
- **本文件只描述契约，不含实现。** 实现由四位同事在各自目录里完成。

---

## 1. 一句话数据流

`discover → enrich → classify → extract → probe → store → publish → cleanup → alert`
（07 §四）。`main.run_cycle` 按这个顺序编排，每个环节是一个 ABC 实现类，
`store/db.py` + `crypto.py` 是共享底座，`interfaces.py` 是它们之间的**消息格式**。

```
                ┌──────────────── interfaces.py（契约，只读）────────────────┐
                │ RawPost FullPost ClassifiedPost CredentialPair ProbeOutcome │
                │ ProbeState VerdictDecision FeedEntry ClassifyRule           │
                │ SourceAdapter Classifier CredentialExtractor Prober         │
                │ VerdictMachine FeedBuilder Reporter  +  常量/阈值/正则       │
                └──────────────────────────────────────────────────────────────┘
   sources/ ──RawPost──▶ enrich ──FullPost──▶ classify/ ──ClassifiedPost──▶
   extract/ ──CredentialPair──▶ probe/ ──ProbeOutcome──▶ VerdictMachine
                                          │
                                          ▼
                                 store/db.py  (token_keys / probe_log /
                                 │            crawl_state / manual_queue)
                                 ▼
                            publish/ (feed.xml + 日报)  ──▶ alert.py (钉钉)
```

任何一环没实现就 `raise NotImplementedError`，`run_cycle` 把它记进
`CycleResult.pending` 并以退出码 0 收尾——所以骨架阶段 `--once` 全程可跑。

---

## 2. 文件所有权边界（最关键，越界即冲突）

四个同事**并发写同一仓库**。边界按“目录”切，谁都不许动别人目录里已定稿的骨架文件。

### 2.1 骨架已定稿、实现者**只读**（禁止编辑）

| 文件 / 目录 | 为什么锁定 |
|---|---|
| `crawler/interfaces.py` | 跨模块唯一契约。改了它=四个人的接口同时漂移，正是 P0-1 要消除的问题。 |
| `crawler/store/db.py` | 存储语义 + 列所有权 + 安全红线（脱敏/密文列）已定；所有 SQL 参数化。 |
| `crawler/crypto.py` | Fernet/mask/sha256 是 §8.5 红线的唯一实现点。 |
| `crawler/config.py` | `.env` 加载 + `redacted()` 脱敏已定。 |
| `crawler/main.py` | 编排顺序与 CLI 约定已定；它是契约的**消费者参考实现**。 |
| `crawler/alert.py` | 出站告警的 `scrub()` 红线在此。 |
| `crawler/fixtures/**` | 02 原文 + `sk-TESTFAKE` 伪造 key，验收回放基准。 |

**发现契约有问题怎么办？** 不要私改上述文件、不要在本地打补丁绕过。把“哪个契约、
哪里不对、建议怎么改”写进你目录下的模块 docstring 顶部 `CONTRACT-ISSUE:` 一行，
然后在集成时提出。骨架文件由本人（P0-1）统一修正并更新本文件。

### 2.2 各实现者**可写**目录

| 同事 | 任务（07 §5.1） | 可写目录 / 文件 | 不可越界 |
|---|---|---|---|
| A | P0-2 / P0-3 | `sources/`（`base.py`、`linux_sb.py`） | 不改 `interfaces.py` 的 `RawPost/FullPost/SourceAdapter` |
| B | P0-4 / P0-5 | `classify/`（`engine.py`、`rules_common.py`、`rules_linux_sb.py`）+ `extract/`（`credentials.py`） | 不改 `ClassifyRule/ClassifiedPost/CredentialPair`；不写 SQL |
| C | P0-6 | `probe/`（`prober.py`、`verdict.py`） | 不改 `ProbeOutcome/ProbeState/VerdictDecision`；判 dead 前必须读 §5 |
| D | P0-8 / P0-9 | `publish/`（`feed.py`、`report.py`） | 不改 `FeedEntry`；feed 永不含明文 key（§6） |

- `store/` 的 P0-7 **已由骨架完成**（07 §5.1 P0-7：连跑两轮无重复入库）。若某环节需要
  `db.py` 没有的查询，同样走“报契约问题”，由骨架补函数，实现者不改 `db.py`。
- 每个目录里的**当前文件都是签名完备的 stub**：函数体 `raise NotImplementedError(...)`，
  docstring 写清了“要照 07 哪一条做什么”。同事 = 把 raise 换成实现，不改签名、不改 docstring 里的契约约束。

### 2.3 测试入口（统一，勿另起）

```
python -m unittest discover -s crawler -p "test_*.py"   # 仓库根执行
python crawler/main.py --print-config                    # 仓库根执行
python crawler/main.py --once
python crawler/main.py --dry-run
```

- 测试**自给自足**：内存 SQLite / tempfile，绝不依赖 `crawler/data/` 真实库、绝不联网、
  绝不依赖真实 key。
- stub 的 `NotImplementedError` 不测（它们是占位，等实现者替换）。已绿的测试覆盖：
  `crypto` / `config` / `store.db` / `fixtures` 安全红线。

---

## 3. 契约清单（`interfaces.py`）

### 3.1 消息 dataclass（生产方 → 消费方）

| 类型 | 谁产出 | 谁消费 | 关键字段语义 |
|---|---|---|---|
| `RawPost` | `SourceAdapter.discover` | `enrich` | `tid` 水位游标对象；`fingerprint()` 取正文前 40 字符去重（§8.2 / 07 §四①）。字段名对齐聚合 API（02 A.3），适配层近乎直映射。 |
| `FullPost` | `SourceAdapter.enrich` | `Classifier` | `article_body` 来自 JSON-LD `@graph→DiscussionForumPosting.articleBody`，绕开 200 字截断；`reply_visible_locked`/`virtual_card` 是 DOM 嗅探布尔；富集失败 `enriched=False` + 截断文本（不 raise 进循环）。`text` 属性给“最佳可用正文”。 |
| `ClassifyRule` | `classify/rules_*`、`SourceAdapter.classify_rules` | `Classifier` | frozen。引擎按 `priority` 升序、首个命中即停，再落 E。**B→C→D→A→E 由数据（priority）强制，不靠代码顺序**（§8.1：B 必须早于 C，因 tid 23295 的 key 长在回复门禁内）。`low_confidence=True` 的规则命中转 `manual_queue`。 |
| `ClassifiedPost` | `Classifier.classify` | `extract` / `run_cycle` | `category` ∈ `CATEGORIES`；`matched_rule` 记规则名（`B`/`C`/`D-badge`/`A1`…）；`low_confidence` → 入人工队列。 |
| `CredentialPair` | `CredentialExtractor.extract` | `Prober` / `store` | **`key` 是明文，只短暂存活于内存**；`__repr__` 自动脱敏。`confidence` ∈ `CONFIDENCES`（§8.2 同 URL 同行=high/行距≤3=medium/多对多=low）。`.mask()`→`crypto.mask`、`.hash()`→`crypto.sha256_hex`。 |
| `ProbeOutcome` | `Prober.probe` | `VerdictMachine` / `store.insert_probe_log` | 与 `probe_log` 一行 1:1。`http_status=0` 表示 `000`/超时。`error_message_raw` **仅审计，永不上页面/feed/告警正文**（§8.5）。 |
| `ProbeState` | `store.get_token_key` + `count_unknown_streak` | `VerdictMachine.next` | “上一轮持久化状态”，含跨轮计数（dead 需跨轮连续 2 次一致，07 §8.3）。 |
| `VerdictDecision` | `VerdictMachine.next` | `run_cycle` → `store` | `escalate=True` 时 `run_cycle` 落 `manual_queue`。 |
| `FeedEntry` | `store.select_publishable`（经 `main._feed_entries`） | `FeedBuilder` / `Reporter` | 只含脱敏字段（`key_masked`、`guide_text`）；**明文 key 物理上无法进入**（§8.5）。 |

### 3.2 抽象基类（每个一个 owner）

| ABC | 方法 | owner 目录 | 契约要点 |
|---|---|---|---|
| `SourceAdapter` | `discover(since_tid)`, `enrich(post)`；非抽象 `classify_rules()` | sources/ | UA 必带否则聚合 403；`limit` 上限 100、`page` 无效→不能翻页（02 A.3）。sitemap 兜底切换**必须** `alerter.notify()`（07 §5.4⑥）。新增来源=一个子类 + 其专属规则，其余不动（D10）。 |
| `Classifier` | `classify(post)` | classify/ | 严格 B→C→D→A→E，首个命中即停。 |
| `CredentialExtractor` | `extract(post)` | extract/ | 先剥 `Bearer` 前缀再匹配（§8.2）；`sk-` 尾部**不得按 `-` 再切**（New API 自身特性，07 明示）。 |
| `Prober` | `probe(pair)` | probe/ | 探测阶梯 0–4，级 4 计费且 `ENABLE_PAID_PROBE` 默认关。`000`/超时/5xx → `unknown`，**绝不判 dead**（最大误报源，60 路并发实测 3.3–6.7%）。 |
| `VerdictMachine` | `next(previous, outcome)` | probe/ | 纯函数：`dead` 需连续 2 次一致 invalid 且间隔 ≥30s；403 永不 dead；`unknown` 连续 5 轮 → escalate。 |
| `FeedBuilder` | `build(entries)`, `write(xml)` | publish/ | RSS 2.0，排除 `dead`（D3）；**原子写**：同目录 temp + `os.replace`。 |
| `Reporter` | `build(stats)`, `write(text)` | publish/ | 日报含新帖数/分类分布/新 key/状态变化/异常/人工队列新增。 |

---

## 4. 阈值与常量（07 可追溯，勿在实现里写死数字）

| 常量 | 值 | 07 出处 |
|---|---|---|
| `UNKNOWN_ROUNDS_TO_MANUAL` | 5 | §8.3「unknown 连续5轮未决→人工队列」 |
| `DEAD_CONSECUTIVE_INVALID` | 2 | §8.3「dead 需连续2次一致」 |
| `DEAD_CONFIRM_MIN_INTERVAL_S` | 30 | §8.3「间隔 ≥30s」 |
| `PROBE_LOG_RETENTION_DAYS` | 90 | §5.1 P0-7（06 修订） |
| `DEAD_REPROBE_INTERVAL_S` | 86400 | §8.3 / D3「dead 每天复探1次」 |
| `FINGERPRINT_LEN` | 40 | §四① 正文前40字符去重 |
| `TRUNCATED_BODY_LEN` | 200 | §5.1 P0-3 富集失败降级用聚合截断文本 |
| `AGG_LIMIT_MAX` | 100 | §三 / 02 A.3 |
| `PROBE_PER_HOST` / `PROBE_GLOBAL` / `PROBE_SAME_HOST_MIN_INTERVAL_S` | 2 / 16 / 0.5s | §8.3 并发 |
| `PROBE_MAX_BODY_BYTES` | 4096 | §8.3 只读状态行+前4KB |
| `PAIR_MEDIUM_MAX_LINE_GAP` | 3 | §8.2 行距≤3=medium |
| `PAIR_DISAMBIG_MAX_CANDIDATES` | 8 | **非 07 数字**：07 只说“候选组合各发一次 GET /v1/models”，此为安全上限，防病态帖烧请求数。 |

正则与标记常量（`PRIMARY_CREDENTIAL_RE`、`GENERIC_CREDENTIAL_RE`、`GOOGLE_CREDENTIAL_RE`、
`C_CLASS_RE`、`D_BADGE_MARKERS`、`D_KEYWORDS_RE`、`A1_RE`/`A2_RE`/`A3_RE`、
`AFFILIATE_ID_FALSE_POSITIVE_RE`、`CDK_RE`、`REPLY_VISIBLE_LOCKED_MARKER`、
`JSONLD_POSTING_TYPE`、`PREFIX_BASE_URL_HINTS`）**只在 `interfaces.py` 定义一次**，实现里
`import` 复用。理由：这些串逐字对应 07 §8.1 的实测命中数（板块2：B=11/C=6/D=16/A=21/E=52），
手抄改一个字就会让 P0-4/P0-5 的回放验收对不上。`CDK_RE` 来自 02 D.7、**不在 07 §8.1**，故只作辅助、永不单独定类。

---

## 5. 存储契约（`store/db.py`，列所有权）

表 = 07 §8.4 的 `token_keys`/`probe_log`/`reveal_log` 逐字 + 两张 P0 专属表
（`crawl_state` 存 tid 水位；`manual_queue` 存低置信/E 疑似/D 福利情报/unknown 停滞）。

**并发写同列的隐患靠“列所有权”消除：**

- `upsert_token_key` 命中 `UNIQUE(key_hash, base_url)` 时，UPDATE 只刷
  `key_masked/provider/models/source/confidence/note/updated_at`；
  `key_encrypted` 用 `COALESCE(:key_encrypted, key_encrypted)`——重探不回传密文时**不抹掉旧密文**。
- `verdict/consecutive_failures/last_probe_at` **只由 `update_verdict` 写**。upsert 绝不碰它们，
  否则每轮都会重置“连续2次一致”计数，dead 判定失效。
- `deal_status` **只由 `set_deal_status` 写**（D12 下架）。upsert 绝不把 hidden 复活成 published。
- `first_seen_at/created_at/source_*` 是身份历史，update 不覆盖。

安全：本层**不加密、不脱敏、不哈希**——调用方传已算好的 `key_hash/key_masked/key_encrypted`。
红线集中在 `crypto`/`config` 一处。所有 SQL 参数化，无字符串插值（`test_store_db.py` 有源码级断言）。

**两个已知契约张力（骨架已处理，勿再引入）：**

1. **C 类指引行的 `key_hash`**：07 §8.4 让 C 类复用 `token_keys` 且“key 列留空”，但
   `UNIQUE(key_hash, base_url)` 会把所有空串指引行塌成一条。骨架用 `guide_key_hash(source_id, tid)`
   （sha256("guide|sid|tid")，**不含任何凭证**）作哨兵，`key_masked/key_encrypted/base_url` 仍空，
   于是多条指引可共存且零密钥落地，07 §8.4/§8.5/D2 同时成立。DDL 未改。
2. **`unknown 连续5轮`无列可依**：§8.4 权威 DDL 没有轮次计数列，故 `count_unknown_streak` 从
   `probe_log` 派生（最近连续 unknown）。`main.run_cycle` 在**插入本轮 outcome 之前**读取它作为
   上一轮状态。

---

## 6. 安全红线（07 §8.5）——四条实现都必须遵守

1. **明文 key 绝不进 feed / 日报 / 日志 / 代码 / 测试 / fixtures**；fixtures 一律 `sk-TESTFAKE` 前缀。
   `test_fixtures_safety.py` 全仓扫描 `crawler/`，任何凭证形状的串非 `sk-TESTFAKE` 前缀即红。
2. **真实 key 只以 Fernet 密文存在本地 SQLite**（`token_keys.key_encrypted`）。`FERNET_KEY`
   未配置时 `run_cycle` 跳过入库（告警），**绝不回落明文**。
3. **出站兜底脱敏**：`crypto.mask`（前6+*+后4）/`mask_full`（配置/告警整体打星）；
   `CredentialPair.__repr__` 自动脱敏；`alert.scrub` 把消息里凭证形状串替换掉；
   `DingTalkAlerter.__repr__` 连 webhook（带 `access_token`）都打码。
4. **C 类只存“链接+指引”**，不提取 gated 内容（07 §5.3 / D2）。

---

## 7. 当前状态与下一步

- 已实现并测试：`interfaces/crypto/config/store.db/alert` + 骨架 CLI/编排 + fixtures + 4 组测试
  （`python -m unittest discover -s crawler` 全绿）。
- stub 待替换（`NotImplementedError`）：`sources/linux_sb`（P0-2/3）、`classify/*`（P0-4）、
  `extract/credentials`（P0-5）、`probe/prober|verdict`（P0-6）、`publish/feed|report`（P0-8）。
- P0 不做（07 §5.3）：不写 FavsHub、不 POST 线上、不养号（D1）、不群通知（D4）、不 LLM 复判（P2）。
- 依赖：仅标准库 + `cryptography`（见 `crawler/requirements.txt`）。目标运行时为服务器
  Python 3.11，但骨架只用 3.10 兼容写法（无 `StrEnum` 等 3.11-only）。
