/**
 * 通告状态常量（前端可见部分）。
 *
 * 为什么要单独一份而不是直接从 server/utils/token-deals.ts 导入：
 * 那个文件顶部 `import Database from 'better-sqlite3'` 等一堆服务端依赖，
 * 被前端组件导入会把 node 模块打进客户端包。所以前端只放**纯常量**，
 * 服务端那份是真相源，两边用同一组字符串字面量 —— 类型系统保证拼错会红。
 *
 * ⚠️ 改这里必须同步 server/utils/token-deals.ts 的 DEAL_STATES / DEAL_STATE_LABELS。
 * 有测试断言两边一致（scripts/third-batch-server.mjs）。
 */

export const SETTABLE_STATES = ['pending', 'verified', 'published', 'offline', 'invalid', 'rejected'] as const
export type DealState = (typeof SETTABLE_STATES)[number] | 'deleted'

export const DEAL_STATE_LABELS: Record<DealState, string> = {
  pending: '待审核',
  verified: '已审核',
  published: '已发布',
  offline: '已下架',
  invalid: '已失效',
  rejected: '已驳回',
  deleted: '已删除',
}

/** 状态语义说明（前端下拉/按钮的 tooltip，避免用户误解「已审核」等于「上线」） */
export const DEAL_STATE_HINTS: Record<DealState, string> = {
  pending: '等待管理员审核，前端不展示',
  verified: '审核已通过（可信标记），但尚未发布，前端不展示',
  published: '已发布，前端展示中',
  offline: '已下架，前端不展示',
  invalid: '已失效，前端不展示',
  rejected: '已驳回，前端不展示',
  deleted: '已删除，前端不展示',
}

/** 只有这一个状态对公众可见 */
export const PUBLIC_STATE: DealState = 'published'
