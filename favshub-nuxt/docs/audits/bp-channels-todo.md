# 竞品渠道（bp-）运营待办清单

> 生成时间：2026-11-04 05:52:24
> 数据来源：从 baipiao.org/free/ 导入，共 **116** 条，全部为 `status=pending`（前台不展示）

## 一、必须做的事：替换链接后才能发布

每一条都要把「领取/官网链接」换成**你自己核实可用**的地址，然后才能在后台 approve。
原因：导入时 `url` 只有两种情况 —— 对方能抽到官方地址的用它（104 条），抽不到的回落成对方详情页（12 条）。

### 1.1 需要你**自己找官网**的 12 条（对方是 Base64 Key / Token 分享，没有官网可抽）

| # | id | 标题 | 对方链接 |
|---|----|------|---------|
| 1 | `bp-chybenzun-unlimited-gateway` | chybenzun 无限中转 API Key（35 模型全家桶 · GPT-5 / Claude Opus 4.8 / Gemini 3 · CF Workers · 公开共享） | https://baipiao.org/free/api/chybenzun-unlimited-gateway/ |
| 2 | `bp-claude-pro-oauth-token` | Claude Pro 订阅号共享 OAuth Token · Claude Code 直接蹬（CLAUDE_CODE_OAUTH_TOKEN / base64 明文） | https://baipiao.org/free/api/claude-pro-oauth-token/ |
| 3 | `bp-gc89925-chatgpt-2000usd-base64-key` | GC89925 免费 ChatGPT API（Base64 Key · 2000 刀额度） | https://baipiao.org/free/api/gc89925-chatgpt-2000usd-base64-key/ |
| 4 | `bp-grok-gongyi-pool-key` | Grok 公益池 API Key（Grok-4.3 / 4.20 全家桶 · 13 万号池 · OpenAI 兼容） | https://baipiao.org/free/api/grok-gongyi-pool-key/ |
| 5 | `bp-grok-gongyi-pool-key-0701` | Grok 公益池新号 10 把（Grok-4.3 / 4.20 纯血全家桶 · OpenAI 兼容） | https://baipiao.org/free/api/grok-gongyi-pool-key-0701/ |
| 6 | `bp-grok-sso-tokens` | grok SSO Token 合集（99 个 · 配 grok2api 用） | https://baipiao.org/free/api/grok-sso-tokens/ |
| 7 | `bp-grok-sso-tokens-514` | grok SSO Token 大合集（514 个 · 配 grok2api 白嫖网页版） | https://baipiao.org/free/api/grok-sso-tokens-514/ |
| 8 | `bp-guxiaomo-grok45-15k-accounts-base64-key` | Guxiaomo 免费 Grok-4.5 API Key（约 1.5 万免费号 · Base64） | https://baipiao.org/free/api/guxiaomo-grok45-15k-accounts-base64-key/ |
| 9 | `bp-liantong-coding-plan` | 联通云 CodingPlan Key（aigw·cucloud · 还剩约 1 万次 · 速蹬） | https://baipiao.org/free/api/liantong-coding-plan/ |
| 10 | `bp-stepfun-step-plan-openai-claude-shared-key` | 阶跃星辰 StepFun step_plan 免费 API（OpenAI / Claude 双格式共享 Key） | https://baipiao.org/free/api/stepfun-step-plan-openai-claude-shared-key/ |
| 11 | `bp-wangzt-qwen36-27b-fp8-api-key` | WangZT Qwen3.6-27B-FP8 免费 API Key（OpenAI 兼容 · vLLM 后端） | https://baipiao.org/free/api/wangzt-qwen36-27b-fp8-api-key/ |
| 12 | `bp-wishtoapp-kimi-k3-api-key` | WishtoApp 免费 Kimi-K3 API Key（DeepSeek-V4 域名但实际服务 Kimi-K3 · OpenAI 兼容） | https://baipiao.org/free/api/wishtoapp-kimi-k3-api-key/ |

> ⚠️ 这 12 条大多是「公开共享的 Key/Token 池」，**性质与本站「可领取的免费额度」不同**。
> 建议：要么找到真实服务商官网替换，要么直接**驳回/删除**，不要原样发布 ——
> 发布一个指向别人 Key 池的链接，既有安全风险，也会让本站看起来像 Key 分享站。

### 1.2 其余 104 条（已有官方地址，仍需你点开确认可用）

这些的 `url` 是对方给出的官方地址，但**未经本站核实**。逐条打开确认还能领，再 approve。

## 二、三个占位字段（全部 116 条都需人工判断）

| 字段 | 当前值 | 含义 | 你要做的 |
|------|--------|------|---------|
| `quality` | `中品` | **占位值，不是核验结论** | 按实际质量改成 上上品/上品/中品/下品，否则排序语义被污染 |
| `expires_at` | `NULL` | 未标注截止 | 有明确期限的填上；确实长期有效的保持 NULL |
| `real_name` | 空 | 未标注是否实名 | 填 yes/no/other，前台「领取条件」会用到 |

## 三、按分类统计

| 分类 | 条数 |
|------|------|
| cloud | 19 |
| domain | 13 |
| token | 84 |
| **合计** | **116** |

## 四、操作路径

1. 打开 `/admin/token-deals`（待审核队列）
2. 逐条点开，改 `url`、`quality`、`expires_at`、`real_name`
3. 确认无误后点「通过」→ 才会出现在前台 `/tokens`、分类页、对比页
4. 想让它进「精选对比」（`/tokens/compare`），额外勾选「精选对比」开关

> 提示：116 条一次做完很累。建议按分类分批，先做 **免费域名（13 条）** —— 数量少、辨识度高，做完立刻能验证分类页效果。

## 五、做完后自检

```bash
# 仍待审的条数（应逐步减少）
sqlite3 data/favshub.db "SELECT COUNT(*) FROM token_deals WHERE id LIKE 'bp-%' AND status='pending'"
# 已发布的 bp- 条数（应等于你 approve 的数量）
sqlite3 data/favshub.db "SELECT COUNT(*) FROM token_deals WHERE id LIKE 'bp-%' AND status='approved'"
# 还挂着对方链接的（应为 0，否则是漏改）
sqlite3 data/favshub.db "SELECT COUNT(*) FROM token_deals WHERE id LIKE 'bp-%' AND url LIKE '%baipiao.org%'"
```
