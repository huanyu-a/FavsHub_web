import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Vitest 的 SSR 转换不会展开 import.meta.client；与 Nuxt 客户端编译常量保持一致。
const nuxtClientRuntime = {
  name: 'nuxt-client-runtime',
  enforce: 'pre' as const,
  transform(code: string) {
    if (!code.includes('import.meta.client')) return null
    return { code: code.replaceAll('import.meta.client', 'true'), map: null }
  },
}

export default defineConfig({
  plugins: [nuxtClientRuntime, vue({ template: { transformAssetUrls: false } })],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
  },
})
