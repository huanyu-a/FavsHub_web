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
  site_version: "1.0.45",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增「免费云服务器」分类**：`category` 字段（`token` 默认 / `cloud`），列表支持 `?category=` 筛选， 详情页与卡片有徽标，推送里云服务器条目会先说「类型 免费云服务器」。 录云服务器资源时务必传 `category: 'cloud'`，否则会被算进 API 额度里。",
  "**备注上限 500 → 2000 字**：`note` 现在支持 Markdown、HTML 与图片，展示时由服务端统一渲染并做白名单消毒。 写入时仍然只传 `note` 原文即可；读取时详情会多一个只读的 `note_html`（已消毒的成品，勿再自行渲染 `note`）。"
],
} as const
