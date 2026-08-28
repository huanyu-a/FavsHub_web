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
      baseUrl: 'https://favshub.com',
    },
  },

  // Server-side config
  nitro: {
    externals: {
      // better-sqlite3 is a native module, don't bundle it
      external: ['better-sqlite3'],
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
        // hm.baidu.com：百度统计；img/connect 已允许 https 外链图标与接口
        'Content-Security-Policy': `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://hm.baidu.com https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';`,
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
