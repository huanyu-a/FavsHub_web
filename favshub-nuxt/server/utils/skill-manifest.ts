/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.4.1",
  site_version: "1.0.14",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**修正** 「第一步永远是 describe」一节补充**返回结构判读纪律**：`endpoints` / `recommended_workflow` 是**数组**，`rules` / `resources` / `errors` / `caller` / `scopes` / `skill` 是**对象** —— 写检查脚本前 先判类型（`Array.isArray()` / `isinstance`）再提取；断言必须真的执行、失败即中止，异常被吞等于没检查。 得出「清单缺少某端点」这类结论前，必须跑一次真实检查并打印命中项 —— 把推断当事实输出会把错误结论 传导给下游（实例：客户端把 `endpoints` 当 dict 调 `.keys()`，异常被吞后误报「describe 漏登记 edits」， 实际 29 条端点里 edits 占 5 条、一直都在）。"
],
} as const
