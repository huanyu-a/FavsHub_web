import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 仅覆盖纯函数单测；@ 别名与项目 tsconfig 保持一致
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
