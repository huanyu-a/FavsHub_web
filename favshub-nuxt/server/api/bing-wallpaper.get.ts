/**
 * GET /api/bing-wallpaper — 代理 Bing 每日壁纸 API，避免 CORS 问题
 */
export default defineEventHandler(async () => {
  try {
    const data = await $fetch<any>('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN')
    const img = data?.images?.[0]
    if (img?.url) {
      return { url: `https://www.bing.com${img.url}`, title: img.title, copyright: img.copyright }
    }
    return { url: null }
  } catch {
    return { url: null, error: '获取壁纸失败' }
  }
})