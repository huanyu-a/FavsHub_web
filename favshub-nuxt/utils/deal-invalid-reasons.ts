/**
 * 失效原因（expired / votes / manual）—— **前后端同源**的中文标签与筛选项。
 *
 * 为什么放在 `utils/` 而不是 `server/utils/`：后台「已失效」面板的筛选条（`pages/admin/token-deals.vue`）
 * 也要用它，而 `server/utils/token-deals.ts` 依赖 better-sqlite3，前端 import 不到。
 *
 * 两侧都从本文件派生，加一档只改这里一处：
 *   - 服务端：参数白名单 = `Object.keys(INVALID_REASON_LABELS)`（见 server/api/admin/token-deals/index.get.ts）
 *   - 前端：筛选条选项 = `INVALID_REASON_OPTIONS`
 *
 * ⚠️ `server/utils/token-deals.ts` 另有一份 `INVALID_REASONS` 字面量元组（用于 `InvalidReason` 类型，
 * 元组必须保留字面量类型，没法从本文件的键推导）—— 加档位时两处一起改。
 */
export const INVALID_REASON_LABELS: Record<string, string> = {
  expired: '已过期',
  votes: '社区判定失效',
  manual: '管理员判定失效',
}

/** 后台筛选条选项：顺序即 `INVALID_REASON_LABELS` 的声明顺序，与服务端白名单同序 */
export const INVALID_REASON_OPTIONS = Object.entries(INVALID_REASON_LABELS)
  .map(([value, label]) => ({ value, label }))
