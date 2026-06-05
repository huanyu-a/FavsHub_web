// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
  ],

  // 全局 CSS 通过 layouts/default.vue 的 useHead() 引用 public/ 下的静态文件

  runtimeConfig: {
    jwtSecret: '',
    dbPath: './data/favshub.db',
    corsOrigin: 'http://localhost:3000',
    adminUsers: '',
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
        },
      },
    },
  },

  routeRules: {},

  devServer: {
    port: 3000,
  },
})
