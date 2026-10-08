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
  "**变更** 「福利 Key」上报（2026-10-08 站长拍板）：上行改传 `key_plain` 明文（仅供站点「复制 Key」链路， 卡面只渲染脱敏形态、明文不进页面与 SSR payload），`key_encrypted` 密文不再过网；新增 `post_time`（原帖发帖时间原文字符串）。",
  "**新增** 对账清理 `POST /api/ai/token-keys/prune`（`delete` scope + 仅管理员，`confirm: true` 必带）：每轮快照上报完成后按 `keep` 身份列表清理站点 `published` 存量 —— dead / 下架 / 超 24h 回帖指引行自动从站点消失。",
  "**变更** `GET /api/token-keys` 公开列表：**不再下发 `key_plain` 明文**（仅 `key_masked` + `post_time`）； 完整 key 经 `GET /api/token-keys/{id}/copy` 按需获取（与列表同可见口径：published、非 dead、指引 24h）。`dead` 行恒定过滤不再返回（失效清理）。",
  "**红线** 明文 key 只在复制瞬间经专用端点下发，绝不进入页面渲染、SSR payload、日志或常规响应；`key_hash`、`key_encrypted` 与采集端内部诊断列同样绝不写入日志、报告或响应正文；向用户汇报上报结果时只引用计数与 upsert 结论。"
],
} as const
