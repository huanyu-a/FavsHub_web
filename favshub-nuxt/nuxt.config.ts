// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@pinia/nuxt',
  ],

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
  },

  routeRules: {
    '/admin/**': { ssr: false },
  },

  devServer: {
    port: 3001,
  },
})
