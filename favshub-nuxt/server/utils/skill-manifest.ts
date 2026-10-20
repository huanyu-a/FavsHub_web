/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.9.2",
  site_version: "1.0.35",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 白嫖通告的人工核验时间轴：列表条目多出 `verified_at` / `verify_age_days` / `verify_stale` / `verify_note` 四个**只读**派生字段（AI 令牌写了也不会生效，核验只能站长操作，`verified_by` 不下发）。",
  "**建议** 推荐资源时优先「最近核验 + 社区投票健康」的条目，并如实转述核验日期； `verify_stale=true` 只表示「超过 30 天没复核」，通告仍然可用可见，别当成失效。"
],
} as const
