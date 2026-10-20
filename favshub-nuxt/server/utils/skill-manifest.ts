/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.4",
  site_version: "1.0.39",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**QQ 私聊支持 Markdown**：实测 `POST /v2/users/{openid}/messages` 带 `{\"msg_type\":2,\"markdown\":{…}}` 返回 200（钉钉靠 `### ` 触发卡片，QQ 靠同一特征走 `msg_type=2`），所以 `markdown` 字段的适用平台 从「钉钉」扩到「钉钉 + QQ 私聊」；群聊仍为 `40034105 主动消息失败, 无权限`。",
  "**投递端按目标挑格式**：outbox spool 增加可选 `markdown` 字段，消费端对 `qqbot:` / `dingtalk:` 优先用富文本、其余通道用 `text`；`hermes send` 侧嗅探 `### ` / `](` 后自动降级重试纯文本。",
  "文档补「发之前先按目标挑格式」的自查命令与 `extra.format` 回显说明。"
],
} as const
