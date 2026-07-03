// https://nuxt.com/docs/api/configuration/nuxt-config
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
  },

  // Server-side config
  nitro: {
    externals: {
      // better-sqlite3 is a native module, don't bundle it
      external: ['better-sqlite3'],
    },
    routeRules: {
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'X-XSS-Protection': '1; mode=block',
          'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';",
          // 请求浏览器发送系统色彩偏好（auto 模式首屏精确）
          'Accept-CH': 'Sec-CH-Prefers-Color-Scheme',
        },
      },
    },
  },

  routeRules: {
    '/images/**': {
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
  },

  devServer: {
    port: 3000,
  },
})
