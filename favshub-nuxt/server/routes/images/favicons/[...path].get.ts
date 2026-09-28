/**
 * GET /images/favicons/{file}.png — favicon 缓存文件直出（node 层兜底）
 *
 * Nitro 的静态资源清单在构建期生成（favicon-dir.ts 的设计依赖 compose nginx
 * alias 直出绕过它），单容器部署（无 nginx）时该目录不在清单里、请求全部 404。
 * 此路由从 getFaviconDir() 读取同一目录流式返回，与 nginx 直出语义一致；
 * 有 nginx 时请求不会到达 node，二者不冲突。
 */
import { createError, getRouterParam, setResponseHeaders } from 'h3'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFaviconDir } from '../../../utils/favicon-dir'

export default defineEventHandler((event) => {
  // 只放行单段文件名（取 basename 防目录穿越），与缓存目录的命名约定一致
  const raw = getRouterParam(event, 'path') || ''
  const name = raw.split('/').pop() || ''
  if (!/^[a-zA-Z0-9._-]+\.png$/.test(name)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  const filepath = join(getFaviconDir(), name)
  if (!existsSync(filepath)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  setResponseHeaders(event, {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=2592000, immutable',
    'Access-Control-Allow-Origin': '*',
  })
  return readFileSync(filepath)
})
