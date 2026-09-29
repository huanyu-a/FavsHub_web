/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.3.0",
  site_version: "1.0.12",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 分享卡片 `poster` 风格（夜幕鎏金海报）并成为**默认风格**：额度数字放大至",
  "**变更** `style` 参数白名单扩至六种：`poster`（默认）/ `magazine` / `neon` / `clay` /",
  "**说明** 非法 style 的回退目标由 `magazine` 改为 `poster`。"
],
} as const
