/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.8.0",
  site_version: "1.0.16",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 「福利 Key」可用性投票端点（无需令牌）：`POST /api/token-keys/{id}/vote` （body `{ vote: 'up' | 'down' }`，同向再投 = 取消，反向 = 改票）与 `GET /api/token-keys/my-votes?ids=…`（批量查当前访客投票方向，≤50）。 身份走访客指纹（登录 `fp:u<id>` / 游客 cookie+UA），限频 120 次/小时， 游客同 IP 同 key 最多计 3 票；可见性与公开列表同口径，不可见行 404。",
  "**变更** 公开列表字段白名单 16 → **18**：新增 `vote_up` / `vote_down` 两个投票计数列 （站点本地计数）；列表不含 `my_vote`，需要高亮时用 `my-votes` 端点补拉。"
],
} as const
