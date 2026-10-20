/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.0",
  site_version: "1.0.31",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 通告订阅：站点新增对外事件流与订阅账本，游客装技能后即可让自己的机器人 （Hermes / QQ）自动收到「有新通告 / 通告变更 / 下架 / 续期」。**站点不主动投递** （零出站，也不持有任何群号），投递在游客本机由 `hermes send` 完成 —— 详见新文件 `subscribe.md`。",
  "**新增** `GET /api/token-deals/changes`（公开，无需 PAT）：`?tail=1` 取基线、`?since=<seq>` 取增量、`?token=<sub_token>` 套用订阅过滤条件，响应含 `next_since` 游标；无变化时 304。",
  "**新增** `GET /api/token-deals/feed.atom` 与 `feed.json`（Atom / JSON Feed 1.1）：给 支持订阅 feed 的客户端零代码接入；只含上新 / 变更 / 续期，下架不进 feed。",
  "**新增** `POST/GET/PATCH/DELETE /api/deal-subscriptions[/:token]`（公开，无需 PAT）： `sub_token` 为 32 字节随机凭证、只返回一次；过滤条件支持 `kinds / providers / regions / keywords`； 可暂停 / 恢复 / 退订。**游客只有接收能力**：订阅不能改动站点任何数据，也没有「投递目标」字段。",
  "**配套** 站点侧新增事件表、后台「机器人订阅」面板（订阅清单 + 最近事件，用于排查 「某条变化为什么没推」）。下架事件只带标题与原因，不带额度 / 模型 / 领取链接。"
],
} as const
