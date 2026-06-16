/**
 * Nuxt 服务端插件 — 自动备份定时器
 * 启动时从 system_config 读取备份配置，每分钟检查是否到了执行时间
 */
import { getRawDb } from '../database'
import { getConfig, getConfigInt } from '../utils/config'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BACKUP_DIR = join(process.cwd(), 'data', 'backups')

function localDate(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localTimestamp(): string {
  const d = new Date()
  return `${localDate()}T${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`
}

function performBackup(dbPath: string): boolean {
  try {
    const db = getRawDb()
    db.pragma('wal_checkpoint(TRUNCATE)')

    if (!existsSync(BACKUP_DIR)) {
      mkdirSync(BACKUP_DIR, { recursive: true })
    }

    const timestamp = localTimestamp()
    const backupPath = join(BACKUP_DIR, `auto-backup-${timestamp}.db`)
    copyFileSync(dbPath, backupPath)
    console.log(`[Backup] 自动备份完成: auto-backup-${timestamp}.db`)
    return true
  } catch (err: any) {
    console.error('[Backup] 自动备份失败:', err.message)
    return false
  }
}

function cleanOldCopies(keepCopies: number) {
  try {
    if (!existsSync(BACKUP_DIR)) return
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('auto-backup-') && f.endsWith('.db'))
      .sort()
      .reverse()
    // 保留最新的 keepCopies 份，删除多余的
    for (let i = keepCopies; i < files.length; i++) {
      const { unlinkSync } = require('node:fs')
      unlinkSync(join(BACKUP_DIR, files[i]))
      console.log(`[Backup] 清理旧备份: ${files[i]}`)
    }
  } catch {}
}

let lastBackupDate: string | null = null

function checkAndBackup(dbPath: string) {
  // 每次从 system_config 读取最新配置
  const enabled = getConfig('backup_enabled')
  if (enabled !== 'true') return

  const hour = getConfigInt('backup_hour', 3)
  const minute = getConfigInt('backup_minute', 0)
  const keepCopies = getConfigInt('backup_keep_copies', 7)

  const now = new Date()
  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const today = localDate()

  // 只在配置的小时和分钟执行，且今天还没备份过
  if (currentHour === hour && currentMinute === minute && lastBackupDate !== today) {
    console.log(`[Backup] 触发自动备份 (计划时间: ${hour}:${String(minute).padStart(2, '0')})`)
    const success = performBackup(dbPath)
    if (success) {
      lastBackupDate = today
      cleanOldCopies(keepCopies)
    }
  }
}

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const dbPath = (config.dbPath as string) || join(process.cwd(), 'data', 'favshub.db')

  // 从旧配置文件迁移 lastBackupDate（仅首次）
  const OLD_CONFIG_FILE = join(process.cwd(), 'data', '.backup-config.json')
  try {
    if (existsSync(OLD_CONFIG_FILE)) {
      const { readFileSync } = require('node:fs')
      const saved = JSON.parse(readFileSync(OLD_CONFIG_FILE, 'utf8'))
      if (saved.lastBackupDate) lastBackupDate = saved.lastBackupDate
    }
  } catch {}

  // 每 30 秒检查一次是否需要备份
  const timer = setInterval(() => {
    checkAndBackup(dbPath)
  }, 30 * 1000)

  console.log('[Backup] 自动备份调度已启动')

  // 优雅关闭时清除定时器
  const shutdown = () => {
    clearInterval(timer)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
})
