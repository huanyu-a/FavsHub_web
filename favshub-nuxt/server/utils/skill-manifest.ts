/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.8.1",
  site_version: "1.0.24",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**修正** 「福利 Key」一节曾声称 `describe` 的 `endpoints` 清单会列出上报端点，实际服务端未登记 （`describe` 只覆盖书签 / 文件夹 / 提示词 / 标签 / 通告 / MCP 等路径）—— 改为准确表述： 该通道为 REST 专用、无 MCP 工具且不在 describe 清单内，按文档端点直接调用。",
  "**新增** `examples.md` 补「福利 Key」完整示例：快照上报（幂等 upsert、`dry_run`）、 对账清理 `prune`（`delete` + 管理员 + `confirm`）、公开列表 / 复制 / 投票 / `my-votes`， 并写明秒级时间戳、`verdict` 枚举、投票取消与改票语义、明文红线。",
  "**优化** `examples.md` 小节编号改为连续整数（原 7.5 / 7.6 / 7.7 / 9.5 跳号），便于按号引用。"
],
} as const
