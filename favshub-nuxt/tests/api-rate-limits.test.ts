import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const searchSource = fs.readFileSync('server/api/search/index.get.ts', 'utf8')
const uploadPreviewSource = fs.readFileSync('server/api/sync/upload-preview.post.ts', 'utf8')

describe('高成本端点 L3 限频', () => {
  it('search 复用 IP 限频 30/min，且先于打开数据库与重组 SQL', () => {
    const limiter = 'checkRateLimit(`search:${getClientIP(event)}`, 30, 60_000)'
    expect(searchSource).toContain("import { checkRateLimit, getClientIP } from '../../utils/rate-limit'")
    expect(searchSource).toContain(limiter)
    expect(searchSource.indexOf(limiter)).toBeGreaterThanOrEqual(0)
    expect(searchSource.indexOf(limiter)).toBeLessThan(searchSource.indexOf('const db = getRawDb()'))
  })

  it('upload-preview 在认证后按用户限频 20/min，且先于读取大请求体与预览', () => {
    const limiter = 'checkRateLimit(`sync_upload_preview:u${authUser.id}`, 20, 60_000)'
    expect(uploadPreviewSource).toContain("import { checkRateLimit } from '../../utils/rate-limit'")
    expect(uploadPreviewSource).toContain(limiter)
    expect(uploadPreviewSource.indexOf('const authUser = requireAuth(event)')).toBeLessThan(uploadPreviewSource.indexOf(limiter))
    expect(uploadPreviewSource.indexOf(limiter)).toBeLessThan(uploadPreviewSource.indexOf('const body = await readBody(event)'))
    expect(uploadPreviewSource.indexOf(limiter)).toBeLessThan(uploadPreviewSource.indexOf('previewSyncUpload(getRawDb()'))
  })
})
