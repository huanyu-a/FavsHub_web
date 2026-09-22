/**
 * GET /avatar/:key — QQ 头像代理（游客评测 / 用户资料头像）
 *
 * ## 为什么要代理而不是让前端直连 qlogo
 *
 * 若前端写 `<img src="https://q2.qlogo.cn/headimg_dl?dst_uin=<QQ号>">`，
 * 访客的 QQ 号会**明文出现在页面源码与网络请求**里 —— 任何人查看源码即可拿到该访客的 QQ 号。
 * QQ 号是强身份标识（可直接搜到人），不能这样暴露。
 *
 * 因此路径中的 `:key` 是 AES-256-GCM 加密令牌：前端拿到的是不可逆字符串，
 * 只有服务端能解密还原 QQ 号并回源取图。页面源码与 API 响应里都不含 QQ 号。
 *
 * ## 为什么放在 /avatar/ 而不是 /api/
 *
 * `/api/**` 全局下发 `Cache-Control: no-store`（登录态数据防串号），
 * 而头像应长缓存 —— 同一 URL 内容稳定（QQ 头像变更频率极低）。
 * 独立路径便于在 routeRules 与 nginx 上单独授予长缓存，避免与 API 策略打架。
 *
 * ## 降级
 *
 * 令牌非法 / 上游失败 → 404，前端 `<img @error>` 回退为字母头像，不阻塞页面。
 */
import { setResponseHeaders, createError } from 'h3'
import { fetchQQAvatar, qqFromAvatarParam } from '../../utils/avatar'

export default defineEventHandler(async (event) => {
  const { key } = getRouterParams(event)
  if (!key) {
    throw createError({ statusCode: 404, data: { error: '头像不存在' } })
  }

  // 解密失败一律 404：不区分「令牌格式错」与「校验失败」，不给攻击者任何信号
  const qq = qqFromAvatarParam(String(key))
  if (!qq) {
    throw createError({ statusCode: 404, data: { error: '头像不存在' } })
  }

  const image = await fetchQQAvatar(qq)
  if (!image) {
    throw createError({ statusCode: 404, data: { error: '头像获取失败' } })
  }

  setResponseHeaders(event, {
    'content-type': image.contentType,
    'content-length': String(image.body.length),
    // 长缓存：URL 本身即内容指纹（同一 QQ 恒得同一密文），可放心缓存 7 天。
    // 头像即使更换，最多滞后 7 天，对评论头像完全可接受。
    'cache-control': 'public, max-age=604800',
    // 令牌不可枚举（AES-GCM 密文），且内容非敏感，允许共享缓存
    'x-avatar-proxy': 'hit',
  })

  return image.body
})
