/**
 * Nuxt 服务端插件 — 启动时初始化数据库 + JWT
 * 等效于旧系统的 db.js 顶层执行 + auth.js 密钥加载
 */
import { initDatabase, closeDatabase, getRawDb } from '../database'
import { initializeDatabase } from '../database/migrate'
import { initJwtSecret } from '../utils/jwt'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()

  // 1. 初始化 JWT 密钥
  initJwtSecret(config.jwtSecret || undefined)

  // 2. 初始化数据库连接
  initDatabase(config.dbPath as string)

  // 3. 执行数据库迁移（建表、增量迁移、索引、种子数据）
  const rawDb = getRawDb()
  initializeDatabase(rawDb)

  console.log('[Init] FavsHub Nuxt 服务已启动')

  // 4. 优雅关闭
  const shutdown = () => {
    closeDatabase()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})
