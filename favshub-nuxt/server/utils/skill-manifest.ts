/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.10.0",
  site_version: "1.0.49",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**限频大幅收紧（会打到你，请重读「限频与并发」）**：AI 通道从「每令牌 600 次/分钟」改为 **每令牌 10 次/分钟 *且* 50 次/30 分钟**（两个窗口同时生效），并新增**同令牌并发上限 4**、 **同 IP 兜底**（60 次/分钟、200 次/30 分钟，并发 8）与**全站 IP 分层限频** （读 600/分钟、写 120/分钟、资源类读 1200/分钟，并发 24；页面与静态资源不受限）。 `429` 现在带 `Retry-After` 响应头，`error` 文案点名是哪一层。**按 600 次/分钟写的老脚本会开始 429**， 请改成串行 + 批量端点，并按 `Retry-After` 退避。阈值可由站点运营方用 `FAVSHUB_RL_*` 覆盖， 以 `GET /api/ai/describe` 的 `errors[429]` 为准。",
  "**修复 QQ 订阅推送「只有新通告有格式、其余事件没格式」**：`subscribe.md` 里 `render_for()` 按目标前缀挑格式， 此前只给 `dingtalk` 用 `markdown`，`qqbot:` 一律退回单行纯文本。实际 QQ 官方机器人也支持富文本 （hermes 侧嗅探 `### ` 后改发 `msg_type=2`），站内消费端 `scripts/qq-outbox-deliver.py` 一直是这么做的。 现在按 `目标.split(\":\", 1)[0]` 判定，`qqbot` / `dingtalk` 都用 `markdown`，其余通道仍用 `text`。",
  "**更正此前说明中的事实错误**：1.9.3 / 1.9.5 的条目里写过「钉钉群机器人发 `markdown`，QQ 官方机器人发 `text`」， 并把它当成平台限制 —— 这是错的，QQ 私聊支持 `markdown`（1.9.4 已实测 `msg_type=2` 返回 200）， 真正的限制只是**QQ 群主动消息无权限**。旧条目保留原文以存史，以此条为准。"
],
} as const
