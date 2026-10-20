/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.6",
  site_version: "1.0.41",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**推送只放对读者有用的字段**：`### ` 卡片里去掉了「品级」「地区」两行运营字段—— 订阅者关心的是额度、模型、到期、领取地址，品级/地区属于站内运营信息。",
  "**不暴露投稿人身份**：待审通知从「提交人：昵称」改为「提交人：游客 / 注册用户」； 站内通告详情页的「发布者」只显示用户自填昵称，不再回退到账号名。",
  "公开接口 `/api/token-deals`、`/api/token-deals/{id}`、`/api/collections` 不再下发 `username` 字段（管理员接口不受影响）。"
],
} as const
