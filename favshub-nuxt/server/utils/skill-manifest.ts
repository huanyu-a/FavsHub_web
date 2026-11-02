/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.11.0",
  site_version: "1.0.59",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**通告订阅全面优化 Hermes 方案**：",
  "规范并优先推荐 Hermes 订阅方案（路径 A：Hermes 原生 Feed 订阅，零代码直接配置；路径 B：Hermes 技能 + `hermes send` 投递，全事件覆盖）；",
  "去除脆弱的外部 Python 脚本依赖，统一由 Hermes 本机接管机器人通道与凭证管理，保障最高安全性与零封号合规；",
  "针对 QQ 官方机器人群主动消息，增加 `40034105` 权限诊断指引（群主需在群设置中开启【机器人主动在群聊内发言】）与频控说明（单群 1000条/天）。",
  "**服务端出入站全面增强**："
],
} as const
