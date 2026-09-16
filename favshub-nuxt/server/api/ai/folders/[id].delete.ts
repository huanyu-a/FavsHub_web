/**
 * DELETE /api/ai/folders/:id — 删除文件夹（delete）
 * Body: { confirm: true, dry_run? }
 *
 * 注意：不会删除文件夹内的书签，而是把书签的 folder_id 置空、子文件夹上提。
 */
import { getRouterParams, readBody } from 'h3'
import { getRawDb } from '../../../database'
import { defineAiHandler } from '../../../utils/ai-auth'
import { deleteFolder } from '../../../utils/ai-service'

export default defineAiHandler('delete', async (event, token) => {
  const { id } = getRouterParams(event)
  const body = await readBody(event).catch(() => ({}))
  return deleteFolder(getRawDb(), token.user_id, id, body)
})
