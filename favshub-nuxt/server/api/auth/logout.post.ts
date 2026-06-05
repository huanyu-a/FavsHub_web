/**
 * POST /api/auth/logout — 登出（清除 httpOnly cookie）
 */
export default defineEventHandler((event) => {
  setCookie(event, 'favshub_token', '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
  })
  return { success: true }
})
