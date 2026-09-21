/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.2.0",
  site_version: "1.0.7",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 通告分享卡片端点：`GET /api/ai/token-deals/:id/card.png`。",
  "**新增** 响应头 `x-card-style`（生效风格）与 `x-card-cached`（缓存命中状态）。",
  "**说明** 该端点为 `read` scope；未审核通过的通告仅作者与管理员可取。"
],
} as const
