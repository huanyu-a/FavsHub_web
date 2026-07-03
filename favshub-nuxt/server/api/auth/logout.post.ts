/**
 * POST /api/auth/logout — 登出（清除 httpOnly cookie）
 */
export default defineEventHandler((event) => {
  const isSecure = getRequestProtocol(event) === 'https'
  setCookie(event, 'favshub_token', '', {
    path: '/',
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    maxAge: 0,
  })
  return { success: true }
})
