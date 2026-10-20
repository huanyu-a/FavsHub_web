/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.8",
  site_version: "1.0.43",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增「免费云服务器」分类**：`category` 字段（`token` 默认 / `cloud`），列表支持 `?category=` 筛选， 详情页与卡片有徽标，推送里云服务器条目会先说「类型 免费云服务器」。 录云服务器资源时务必传 `category: 'cloud'`，否则会被算进 API 额度里。"
],
} as const
