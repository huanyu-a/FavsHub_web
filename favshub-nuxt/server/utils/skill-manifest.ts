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
  site_version: "1.0.57",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**通告订阅支持 QQ 官方机器人 OpenAPI 直连（面向游客与外部群主）**： 此前 `subscribe.md` 的轮询脚本 `favshub-poll.py` 强依赖本地安装的 `hermes` CLI， 对于没有部署 Hermes 的普通用户/游客门槛极高。 现根据腾讯官方开放平台最新规范，在脚本中内置基于纯 Python 原生 `urllib` 的官方 OpenAPI 直连：",
  "自动换取与缓存 `access_token`（7200 秒 TTL，提前 60 秒刷新）；",
  "目标群直接通过 `POST /v2/groups/{group_openid}/messages` 发送；",
  "报 `304003`（网址未在平台报备）时自动剥离 URL 降级重发纯文本，保障通知必达；",
  "报 `40034105` 时诊断并输出友好指引（群主需在群设置中开启【机器人主动在群聊内发言】）；"
],
} as const
