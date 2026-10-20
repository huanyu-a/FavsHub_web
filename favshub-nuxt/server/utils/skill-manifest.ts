/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.3",
  site_version: "1.0.38",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 订阅事件多出 `markdown` 字段（多行富文本：标题、加粗、字段列表、可点链接）， 与原有的单行 `text` 并存 —— 钉钉群机器人发 `markdown`，QQ 官方机器人发 `text`。",
  "**建议** `subscribe.md` 的 cron 从 `*/10` 收到 `*/2`（站点限 60 次/小时/IP，`*/2` 只占 30 次）， 延迟从十几分钟压到两分钟级。",
  "**说明** 补「钉钉 vs QQ 官方机器人」投递模式差异：钉钉是 webhook 主动推送， QQ 群主动消息需要单独开通权限（未开通返回 `40034105 主动消息失败, 无权限`）， 并给出三条替代路径（申请权限 / OneBot 协议端 / 被动回复）。"
],
} as const
