import { afterEach, vi } from 'vitest';
import { computed } from 'vue';

// WXT 自动导入的 Vue API 在独立 Vitest 进程中显式提供。
Object.assign(globalThis, { computed });

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
