/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.6.0",
  site_version: "1.0.15",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**变更** 「福利 Key」上报（2026-10-08 站长拍板）：上行改传 `key_plain` 明文（页面公开可复制，原「脱敏 + 登录后揭示」流程取消），`key_encrypted` 密文不再过网；新增 `post_time`（原帖发帖时间原文字符串）。",
  "**新增** 对账清理 `POST /api/ai/token-keys/prune`（`delete` scope + 仅管理员，`confirm: true` 必带）：每轮快照上报完成后按 `keep` 身份列表清理站点 `published` 存量 —— dead / 下架 / 超 24h 回帖指引行自动从站点消失。",
  "**变更** `GET /api/token-keys` 公开列表：返回 `key_plain` 明文与 `post_time`；`dead` 行恒定过滤不再返回（失效清理）。",
  "**红线** 明文 key 的展示是站点产品语义，但 `key_hash`、`key_encrypted` 与采集端内部诊断列仍绝不写入日志、报告或响应正文；向用户汇报上报结果时只引用计数与 upsert 结论。"
],
} as const
