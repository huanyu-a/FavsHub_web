/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.5",
  site_version: "1.0.40",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**通知格式统一为 Markdown**：站点侧 10 类通知（通告待审/发布/回待审/删除/通过/驳回、 提示词待审/通过/驳回）全部带 `markdown` 版本（`### ` 标题 + 加粗 + 字段列表 + 可点链接）； QQ 机器人指令回复也自动包成卡片（首行标题、`·` 行换 `-`），`text` 仍保留作纯文本兜底。",
  "订阅事件推送到 QQ 私聊时同样使用 `markdown`（此前只有钉钉用它）， 所以 `text` 现在只用于 OneBot 等纯文本通道。",
  "排查提示：若某条通知仍是单行纯文本，先看该通道是不是走了 OneBot 传输（那里没有富文本）。"
],
} as const
