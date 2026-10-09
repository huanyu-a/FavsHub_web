/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.7.0",
  site_version: "1.0.15",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 复制专用端点 `GET /api/token-keys/{id}/copy`：按需返回 `{ key_plain, base_url }` **完整值**， 与公开列表同一可见口径（`published`、非 `dead`、回帖指引限 24h；指引行恒 404）。 公开列表**不再下发 `key_plain`**，且其中 `base_url` 的 key 形态片段（「URL 即 key」的站点） 已服务端遮蔽 —— 页面渲染、SSR payload、页面源码全程不含完整 key 形态字符串。",
  "**变更** 公开列表排序改为「B 类优先 → `valid` > `quota` > `limited` > 其他 → 收录时间倒序」， 可用 Key 排到最前（原排序按探测时间，有效行会被未知行挤下去）。",
  "**变更** 复制热度计数 `copy_count` 由 copy 端点维护（站点本地数据，爬虫上报不涉及该列）。",
  "**修正** 技能包版本与站点分发清单此前不同步（`SKILL.md` frontmatter 停在 1.5.0）—— 现已对齐， 版本号以本文件与 `SKILL.md` frontmatter 为准。"
],
} as const
