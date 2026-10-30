/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.10.2",
  site_version: "1.0.55",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**字段字典勘误（不改接口行为，只是文档追上实现）**：`GET /api/ai/describe` 原先在字段字典里 列了 `token_deals.deleted_at`、`token_deals.invalid_reason` 与 `prompts.deleted_at`， 但**这三个字段已不再下发**（服务端按「运营审计信息不进公开/AI 出口」的口径剔除）。 字段字典是对外契约，说了有就必须真有 —— 若按旧字典写了 `if (deal.deleted_at)` 这类判断， 它会恒为 `undefined`。",
  "判断通告是否下架：用 `invalid_at`（保留）+ `status`。",
  "判断提示词是否在回收站：用 `GET /api/ai/prompts?recycle=1`（该查询已按身份收紧，只看自己的）。"
],
} as const
