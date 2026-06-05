/**
 * 数据库连接单例 — 基于 better-sqlite3
 * 提供 getDb() 函数供所有 server route 使用
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import * as schema from './schema'

let _db: Database.Database | null = null
let _drizzle: ReturnType<typeof drizzle<typeof schema>> | null = null

/**
 * 获取原生 better-sqlite3 实例
 */
export function getRawDb(): Database.Database {
  if (!_db) {
    throw new Error('[DB] 数据库尚未初始化，请先调用 initDatabase()')
  }
  return _db
}

/**
 * 获取 Drizzle ORM 实例
 */
export function getDb() {
  if (!_drizzle) {
    throw new Error('[DB] 数据库尚未初始化，请先调用 initDatabase()')
  }
  return _drizzle
}

/**
 * 初始化数据库连接
 * @param dbPath SQLite 数据库文件路径
 */
export function initDatabase(dbPath: string) {
  if (_db) return // 已初始化则跳过

  const absPath = resolve(dbPath)
  const dir = dirname(absPath)

  // 确保 data 目录存在
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  _db = new Database(absPath, { timeout: 10000 })

  // 启用 WAL 模式 + 外键约束
  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.pragma('busy_timeout = 5000')

  // 创建 Drizzle ORM 实例
  _drizzle = drizzle(_db, { schema })

  console.log(`[DB] 已连接: ${absPath}`)
}

/**
 * 安全关闭数据库连接
 */
export function closeDatabase() {
  if (_db) {
    try {
      _db.pragma('wal_checkpoint(TRUNCATE)')
      _db.close()
      console.log('[DB] 数据库已关闭')
    } catch (err) {
      console.error('[DB] 关闭失败:', err)
    }
    _db = null
    _drizzle = null
  }
}
