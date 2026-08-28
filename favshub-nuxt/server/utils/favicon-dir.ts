/**
 * favicon 本地缓存目录统一解析
 *
 * 容器内 compose 卷挂载在 .output/public/images/favicons（nginx 同步挂载直出），
 * 本地开发为 public/images/favicons；下载端点与代理端点必须写同一个目录，
 * 否则写入的文件不落卷、nginx 读不到、容器重建即丢。
 * 通过 FAVICON_DATA_DIR 环境变量可显式覆盖。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function getFaviconDir(): string {
  if (process.env.FAVICON_DATA_DIR) return process.env.FAVICON_DATA_DIR
  // Nitro 生产产物运行时 cwd 为 .output 所在目录，.output/public 即静态根
  return join(process.cwd(), '.output', 'public', 'images', 'favicons')
}

/** 历史数据可能落盘在任一候选目录（.output/public 或 public），返回第一个存在的文件；都不存在返回 null */
export function resolveExistingFaviconFile(safeHostname: string): string | null {
  const candidates = [
    join(getFaviconDir(), `${safeHostname}.png`),
    join(process.cwd(), 'public', 'images', 'favicons', `${safeHostname}.png`),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}
