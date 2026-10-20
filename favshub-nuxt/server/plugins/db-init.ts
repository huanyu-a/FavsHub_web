/**
 * Nuxt 服务端插件 — 启动时初始化数据库 + JWT
 * 等效于旧系统的 db.js 顶层执行 + auth.js 密钥加载
 */
import { initDatabase, closeDatabase, getRawDb } from '../database'
import { initializeDatabase } from '../database/migrate'
import { initJwtSecret } from '../utils/jwt'
import { archiveExpiredDeals } from '../utils/token-deals'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  // 1. 初始化 JWT 密钥
  initJwtSecret(config.jwtSecret || undefined)

  // 2. 初始化数据库连接
  initDatabase(config.dbPath as string)

  // 3. 执行数据库迁移（建表、增量迁移、索引、种子数据）
  const rawDb = getRawDb()
  initializeDatabase(rawDb)

  // 3.1 过期通告归档：把「已通过但有效期已过」的条目落成 invalid(expired)，
  // 使后台「已失效」面板的「已过期」统计与失效时间准确（公开列表不依赖它，运行时另判一次）。
  // 启动时跑一次即可 —— 无定时任务，后台进入「已失效」面板时也会再跑（见 admin 端点）。
  try {
    const archived = archiveExpiredDeals(rawDb)
    if (archived > 0) console.log(`[Init] 已归档过期通告 ${archived} 条`)
  } catch (err: any) {
    console.warn('[Init] 过期通告归档失败（忽略）:', err?.message || err)
  }

  console.log('[Init] FavsHub Nuxt 服务已启动')

  // 4. 优雅关闭
  const shutdown = () => {
    closeDatabase()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})
