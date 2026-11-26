/** POST /api/sync/upload-preview — 只读内存预演；只返回计数与原始 revision。 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { checkRateLimit } from '../../utils/rate-limit'
import { previewSyncUpload } from '../../utils/sync-upload-preview'

export default defineEventHandler(async (event) => {
  const authUser = requireAuth(event)
  checkRateLimit(`sync_upload_preview:u${authUser.id}`, 20, 60_000)
  const body = await readBody(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return previewSyncUpload(getRawDb(), authUser.id, body || {})
})
