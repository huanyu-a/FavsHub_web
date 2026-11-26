/** PUT /api/sync/bookmarks — 增量合并同步，支持 expected_revision 乐观锁。 */
import { getRawDb } from '../../../database'
import { requireAuth } from '../../../utils/auth'
import { syncUploadBookmarks } from '../../../utils/sync-upload'

export default defineEventHandler(async (event) => {
  const authUser = requireAuth(event)
  const body = await readBody(event)
  return syncUploadBookmarks(getRawDb(), authUser.id, body || {})
})
