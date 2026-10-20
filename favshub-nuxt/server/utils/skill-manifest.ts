/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.7",
  site_version: "1.0.42",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**修「变更」推送说不出改了什么**：数组字段（`models` 等）的差异此前先截断到 30 字再比较， 末尾新增的元素会被裁成一样的开头，整条差异被判成「无变化」——订阅者只收到一个干巴巴的 `### ✏️【变更】xxx`。现在按完整值比较，且数组差异渲染成 `支持模型 +新增项 -移除项`。",
  "文档同步：`markdown` 的适用平台写清「钉钉群机器人 + QQ 官方机器人私聊」。"
],
} as const
