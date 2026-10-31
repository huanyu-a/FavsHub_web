/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.10.3",
  site_version: "1.0.55",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**MCP 侧回收站能力补齐**：`list_prompts` 工具新增 `recycle: true` 参数。 此前 REST `GET /api/ai/prompts?recycle=1` 能查回收站，但 MCP 工具的 `inputSchema` 根本没暴露这个参数、描述还写死「不含回收站」—— **同一能力，REST 能用、MCP 用不了**。现已对齐。",
  "**纠正一处过度承诺**：原文写「工具与 REST 端点**一一对应**」，实际有两处例外， 且同一份文档前面又说过 token-keys 是 REST 专用，两句话读起来会打架。现改为 「基本一一对应」并明确列出例外：",
  "`GET /api/ai/token-deals/:id/card.png` —— 无 MCP 工具（PNG 二进制，JSON-RPC 不适合）；",
  "`/api/ai/token-keys*` —— 无 MCP 工具，REST 专用。"
],
} as const
