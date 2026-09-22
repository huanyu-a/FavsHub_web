// https://nuxt.com/docs/api/configuration/nuxt-config
// CSP 区分 dev/prod：dev 模式 HMR 需要 unsafe-eval，生产构建（Nuxt 3.15+）已不需要
const isDev = process.env.NODE_ENV !== 'production'
const scriptSrc = `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://hm.baidu.com`

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  experimental: {
    viewTransition: true,
  },

  features: {
    // 组件 scoped 样式默认被 Nuxt 内联进 SSR HTML 的 <style>（首屏零请求）。
    // 关闭后改为由打包产物 /_nuxt/*.css 以 <link> 引入，收益：
    //   1. HTML 体积减少 ~8KB（首屏 style 块），爬虫/CDN 回源更轻；
    //   2. CSS 带 hash + /_nuxt/** 为 immutable 长缓存，跨页面/二次访问零重复传输；
    //   3. head 无明文样式，便于后续把 CSP 收紧到 style-src 'self'（当前仍需 unsafe-inline
    //      供 Vue :style 绑定的 style 属性使用）。
    // 代价：首屏多 1 个同源 CSS 请求（同样的 render-blocking，不会 FOUC）。
    inlineStyles: false,
  },

  modules: [
    '@pinia/nuxt',
  ],

  components: {
    dirs: [
      { path: '~/components', pathPrefix: false },
    ],
  },

  // 全局 CSS 通过 layouts/default.vue 的 useHead() 引用 public/ 下的静态文件

  runtimeConfig: {
    jwtSecret: '',
    dbPath: './data/favshub.db',
    corsOrigin: 'http://localhost:3000',
    adminUsers: '',
    trustProxy: 'false',
    public: {
      // 站点对外地址：用于 canonical / og:url / og:image / sitemap.xml。
      // 线上部署经环境变量 NUXT_PUBLIC_BASE_URL 覆盖；默认值必须与实际线上域名一致，
      // 否则社交平台抓到的分享图/规范地址会 404
      baseUrl: 'https://hao.bx9y.com.cn',
    },
  },

  // Server-side config
  nitro: {
    externals: {
      // 原生模块（.node 二进制）必须外置：打包器无法内联，
      // 外置后由 .output/server/node_modules 携带运行时依赖。
      //   - better-sqlite3：数据库
      //   - @napi-rs/canvas：服务端分享卡片渲染（server/utils/deal-card.ts）
      external: ['better-sqlite3', '@napi-rs/canvas'],
    },
  },

  routeRules: {
    // 默认：安全头 + 页面级缓存
    // HTML 默认 private（浏览器按用户缓存），避免 CDN 忽略 Vary:Cookie 时把登录用户的
    // 个性化 HTML（含私有书签标题）串给游客。游客访问公开页时由
    // server/middleware/cache-control.ts 升级为 public + s-maxage（允许 CDN 缓存）。
    '/**': {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        // hm.baidu.com：百度统计；img/connect 已允许 https 外链图标与接口；
        // blob: 允许分享卡片预览 <img> 加载 canvas.toBlob 生成的对象 URL
        'Content-Security-Policy': `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://hm.baidu.com https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`,
        // 请求浏览器发送系统色彩偏好（auto 模式首屏精确）
        'Accept-CH': 'Sec-CH-Prefers-Color-Scheme',
        // HTML 浏览器缓存 60s（按用户），共享层不存储
        'Cache-Control': 'private, max-age=60',
        'Vary': 'Cookie',
      },
    },
    // Nuxt 构建产物：长缓存，覆盖 /** 的 private（review: /** 不再覆盖静态资源长缓存）
    '/_nuxt/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Vary': 'Accept-Encoding',
      },
    },
    // 本地静态资源（CSS / 字体库）：长缓存（CSS 通过 ?v= 版本号更新）
    '/css/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Vary': 'Accept-Encoding',
      },
    },
    '/vendor/**': {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Vary': 'Accept-Encoding',
      },
    },
    // API：默认禁止缓存（多为登录态数据，no-store 避免共享/浏览器缓存串号或过期）
    '/api/**': {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
    // 公共只读 API：可被 CDN / 浏览器缓存 5 分钟
    '/api/search-engines': {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    },
    // QQ 头像代理：URL 本身即内容指纹（AES-GCM 密文，同一 QQ 恒得同一 URL），
    // 内容稳定且非敏感 → 长缓存。独立于 /api/** 的 no-store，故单独设规则。
    // 同时覆盖 /** 的 Vary:Cookie —— 头像与登录态无关，共享缓存安全。
    '/avatar/**': {
      headers: {
        'Cache-Control': 'public, max-age=604800',
        'Vary': 'Accept-Encoding',
      },
    },
    // 管理后台 / 登录页：禁止缓存
    '/admin/**': {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
    '/login': {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
    // 站点根图标（含社交抓取用）：长缓存，且覆盖 /** 的 Vary:Cookie（与登录态无关）
    '/favicon.ico': {
      headers: { 'Cache-Control': 'public, max-age=604800', 'Vary': 'Accept-Encoding' },
    },
    '/favicon.png': {
      headers: { 'Cache-Control': 'public, max-age=604800', 'Vary': 'Accept-Encoding' },
    },
    '/apple-touch-icon.png': {
      headers: { 'Cache-Control': 'public, max-age=604800', 'Vary': 'Accept-Encoding' },
    },
    // 静态图片（引擎 logo、本地化 favicon）：长缓存 + 覆盖 /** 的 Vary:Cookie
    '/images/**': {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Vary': 'Accept-Encoding, Origin',
      },
    },
  },

  devServer: {
    port: 3000,
  },
})
