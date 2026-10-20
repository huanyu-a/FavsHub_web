/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.8.2",
  site_version: "1.0.27",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**变更** 通告列表改为「公开可见」口径：**已过期 / 判定失效 / 已删除的通告不再返回**， 详情 / 投票 / 评测 / 建议 / 分享卡片对这类条目统一 404（此前过期通告仍会出现在列表里， 甚至能继续收票与评测，产生「已失效却评分很高」的矛盾数据）。",
  "**变更** `DELETE /api/ai/token-deals/:id` 改为**软删除**语义：前台立即不可见、投票与评测保留、 管理员可恢复，重复删除返回 404；物理清除仅限管理后台。响应仍为 `{ success: true }`， 旧调用不受影响，但「删了就一定没了」的假设不再成立。",
  "**新增** `describe` 的 `token_deals` 字段字典补充 `deleted_at` / `deleted_by` / `invalid_at` / `invalid_reason`（`expired` | `votes` | `manual`）与 `deal_delete` 语义说明， 便于 AI 客户端区分「审核未过」与「已下架」。"
],
} as const
