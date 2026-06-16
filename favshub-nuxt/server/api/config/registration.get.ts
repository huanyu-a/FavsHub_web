/**
 * GET /api/config/registration — 检查是否允许注册（公开接口）
 */
import { getConfig } from '../../utils/config'

export default defineEventHandler(() => {
  return { allowed: getConfig('allow_registration') !== 'false' }
})
