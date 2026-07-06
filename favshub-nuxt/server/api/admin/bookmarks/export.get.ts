/**
 * GET /api/admin/bookmarks/export — 管理员导出全部书签（Netscape Bookmark File Format）
 * 只允许管理员访问
 */
import { getRawDb } from '../../../database'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getRawDb()

  // 获取所有书签（带文件夹名和用户名）
  const bookmarks = db.prepare(`
    SELECT b.title, b.url, b.icon, b.created_at, f.name as folder_name, u.username
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN users u ON b.user_id = u.id
    ORDER BY f.name, b.sort_order
  `).all() as any[]

  // 按文件夹分组
  const groups = new Map<string, any[]>()
  for (const bm of bookmarks) {
    const folder = bm.folder_name || '未分类'
    if (!groups.has(folder)) groups.set(folder, [])
    groups.get(folder)!.push(bm)
  }

  // 生成 Netscape Bookmark File Format HTML
  const lines: string[] = []
  lines.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
  lines.push('<!-- This is an automatically generated file. -->')
  lines.push('<!-- It will be read and overwritten. -->')
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
  lines.push('<TITLE>FavsHub Bookmarks Export</TITLE>')
  lines.push('<H1>FavsHub Bookmarks Export</H1>')
  lines.push('<DL><p>')

  for (const [folder, items] of groups) {
    const addDate = Math.floor(Date.now() / 1000)
    lines.push(`    <DT><H3 ADD_DATE="${addDate}" LAST_MODIFIED="${addDate}">${escapeHtml(folder)}</H3>`)
    lines.push('    <DL><p>')
    for (const bm of items) {
      const addDate = bm.created_at ? Math.floor(bm.created_at / 1000) : Math.floor(Date.now() / 1000)
      const iconAttr = bm.icon ? ` ICON="${escapeHtml(bm.icon)}"` : ''
      lines.push(`        <DT><A HREF="${escapeHtml(bm.url)}" ADD_DATE="${addDate}"${iconAttr}>${escapeHtml(bm.title)}</A>`)
    }
    lines.push('    </DL><p>')
  }

  lines.push('</DL><p>')

  const html = lines.join('\n')

  setResponseHeaders(event, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="favshub-bookmarks-all-${Date.now()}.html"`,
  })

  return html
})

function escapeHtml(str: string): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
