/**
 * GET /api/bookmarks/export — 导出当前用户的书签（Netscape Bookmark File Format）
 * 该格式兼容 Chrome / Firefox / Edge / Safari 的书签导入功能
 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default defineEventHandler(async (event) => {
  const user = requireAuth(event)
  const db = getRawDb()

  // 只导出用户自己的书签
  const bookmarks = db.prepare(
    'SELECT b.title, b.url, b.folder_id, b.icon, b.created_at, b.updated_at FROM bookmarks b WHERE b.user_id = ? ORDER BY b.folder_id, b.sort_order'
  ).all(user.id) as any[]

  // 只导出用户自己的文件夹
  const folders = db.prepare(
    'SELECT id, name FROM folders WHERE user_id = ? ORDER BY name'
  ).all(user.id) as any[]

  const folderMap = new Map<number, string>()
  for (const f of folders) folderMap.set(f.id, f.name)

  // 按文件夹分组
  // 已知限制：仅处理一级文件夹。子文件夹（parent_id 非 null）的书签会被归入"未分类"，
  // 因为当前查询只按 folder_id 映射顶级文件夹名称，未递归展开子文件夹层级。
  // 如需嵌套导出，需要额外查询子文件夹树并递归构建层次结构。
  const grouped = new Map<string, any[]>()
  for (const b of bookmarks) {
    const folderName = b.folder_id ? (folderMap.get(b.folder_id) || '未分类') : '未分类'
    if (!grouped.has(folderName)) grouped.set(folderName, [])
    grouped.get(folderName)!.push(b)
  }

  // 生成 Netscape Bookmark File Format HTML
  const lines: string[] = []
  lines.push('<!DOCTYPE NETSCAPE-Bookmark-file-1>')
  lines.push('<!-- This is an automatically generated file.')
  lines.push('     It will be read and overwritten.')
  lines.push('     DO NOT EDIT! -->')
  lines.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">')
  lines.push('<TITLE>Bookmarks</TITLE>')
  lines.push('<H1>Bookmarks</H1>')
  lines.push('<DL><p>')

  // 无文件夹的书签直接放在顶层
  const ungrouped = grouped.get('未分类') || []
  for (const b of ungrouped) {
    const addDate = Math.floor((b.created_at || Date.now()) / 1000)
    const iconAttr = b.icon ? ` ICON="${escapeHtml(b.icon)}"` : ''
    lines.push(`    <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${addDate}"${iconAttr}>${escapeHtml(b.title)}</A>`)
  }

  // 按文件夹输出
  for (const [folderName, items] of grouped) {
    if (folderName === '未分类') continue
    lines.push(`    <DT><H3>${escapeHtml(folderName)}</H3>`)
    lines.push('    <DL><p>')
    for (const b of items) {
      const addDate = Math.floor((b.created_at || Date.now()) / 1000)
      const iconAttr = b.icon ? ` ICON="${escapeHtml(b.icon)}"` : ''
      lines.push(`        <DT><A HREF="${escapeHtml(b.url)}" ADD_DATE="${addDate}"${iconAttr}>${escapeHtml(b.title)}</A>`)
    }
    lines.push('    </DL><p>')
  }

  lines.push('</DL><p>')

  const html = lines.join('\n')

  setResponseHeaders(event, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="favshub-bookmarks.html"`,
  })

  return html
})
