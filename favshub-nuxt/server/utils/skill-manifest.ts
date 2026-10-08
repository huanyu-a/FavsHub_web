/**
 * 自动生成 —— 请勿手工编辑。
 * 由 `scripts/build-skill-manifest.mjs` 依据 `../favshub-data-ops/` 生成。
 * 重新生成：pnpm skill:manifest
 *
 * 供 `/api/ai/describe` 暴露技能版本，使 AI 客户端能自查是否有新版本。
 */
export const SKILL_MANIFEST_META = {
  name: "favshub-data-ops",
  version: "1.5.0",
  site_version: "1.0.15",
  manifest_path: '/skills/favshub-data-ops.json',
  source: "https://github.com/huanyu-a/FavsHub_web/tree/main/favshub-data-ops",
  latest_changes: [
  "**新增** 「福利 Key」**上报通道**文档化：采集端经 `POST /api/ai/token-keys`（`write` scope）把探测到的 Key 快照上报站点，按 `(key_hash, base_url)` **幂等 upsert** —— 普通令牌上报进入 `pending` 待审， 管理员令牌直接 `published`；支持 `dry_run` 预演。时间戳沿采集端语义存**秒**（与站点其余表的毫秒不同）。",
  "**新增** 公开脱敏列表 `GET /api/token-keys`（**无需令牌**）：恒定只返回 `published` 行、 14 字段白名单（`key_masked` 脱敏展示），敏感列（明文 / `key_hash` / `key_encrypted` / 内部诊断）不出现在任何返回。",
  "**红线** 明文 key、`key_hash`、`key_encrypted` 绝不写入日志、报告或响应正文 —— 向用户汇报上报结果时 只引用脱敏字段与 upsert 结论。",
  "该通道暂无 MCP 工具（REST 专用）；`/api/ai/describe` 的 `endpoints` 清单会同步列出。"
],
} as const
