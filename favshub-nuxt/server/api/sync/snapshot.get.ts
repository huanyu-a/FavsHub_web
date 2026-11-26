/** GET /api/sync/snapshot — 当前用户全量同步快照与并发 revision。 */
import { getRawDb } from '../../database'
import { requireAuth } from '../../utils/auth'
import { getUserSyncSnapshot } from '../../utils/sync-snapshot'

export default defineEventHandler((event) => {
  const authUser = requireAuth(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return getUserSyncSnapshot(getRawDb(), authUser.id)
})
