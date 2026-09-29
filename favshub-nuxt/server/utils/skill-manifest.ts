/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.4.0",
  site_version: "1.0.14",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 通告**修改建议（提案）通道**文档化：普通用户可对**任何人（含管理员）已公开**的通告",
  "**变更** 越权编辑已公开通告的响应由 **404 统一返回** 改为 **403 + 提案通道指引**",
  "**修正** 技能红线第 4 条与错误码表：明确「不改动他人数据」的合法通道是提交修改建议，不是绕过隔离；"
],
} as const
