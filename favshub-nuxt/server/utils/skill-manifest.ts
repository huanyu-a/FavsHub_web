/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.1",
  site_version: "1.0.34",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**修正** `subscribe.md` 的状态文件改用 `0600` 创建（里面存着 `sub_token`，等同密码）； 补充「凭证走 URL query 可能被反代 / 抓包日志记下」的提醒与泄露处置（退订后重建）。",
  "**说明** 站点侧同步收紧：事件流按「当前可见性」收敛（已下架 / 失效 / 到期通告的历史 事件不再吐额度、模型与领取链接），feed 限频并拒绝共享缓存，订阅端点限频与死订阅淘汰。 游客脚本**无需改动**，但建议更新到本版本重读 `subscribe.md`。"
],
} as const
