/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.10.1",
  site_version: "1.0.53",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**限频上调（对你是好消息，但仍请按新值规划）**：AI 通道从「每令牌 10 次/分钟 且 50 次/30 分钟」 上调为 **每令牌 25 次/分钟 且 250 次/30 分钟**（两个窗口仍同时生效）。 原因：10/50 实测连本站自己的 AI 功能回归套件都跑不完（单个用例需连打 20+ 个 AI 请求，第 11 个就 429）， 正常干活的助手会被误伤。**IP 兜底（60 次/分钟、200 次/30 分钟）、同令牌并发 4、全站 IP 分层限频均未变。** 阈值仍以你站点 `GET /api/ai/describe` 的 `errors[429]` 为准 —— 各站可用 `FAVSHUB_RL_*` 自行覆盖， 所以**不要把我这里的数字写死进脚本**，读 `Retry-After` 退避才是稳妥做法。"
],
} as const
