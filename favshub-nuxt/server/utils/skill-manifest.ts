/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.12.0",
  site_version: "1.0.82",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**通告状态字段改为 `state` 单列（站点 1.0.76 起的契约变更）**：",
  "新增 `state` 字段说明与七档取值表（`pending` / `verified` / `published` / `offline` / `invalid` / `rejected` / `deleted`），**只有 `published` 对外可见**， 其余六档对匿名与搜索引擎一律 404；",
  "新增档次 **`verified`（已审核）**= 审核已通过但尚未发布，只表示内容可信、**不对外可见**。 站长导入渠道后先置 `verified`，替换好链接再发布；",
  "**⚠️ 不要再用 `status` 判断可见性**：`status` 已降级为旧列（双写备份）， 粒度不足 —— `verified` 与 `published` 的 `status` 都是 `approved`， 按 `status` 判断会把「还没发布」的条目误当成已公开。**一律以 `state` 为准**；",
  "明确 **AI 令牌不能写 `state`**：审核 / 发布 / 下架都是站长在后台的动作， AI 侧只能创建（管理员 → `published`，普通用户 → `pending`）、提交修改建议、下架或删除自己的条目；"
],
} as const
