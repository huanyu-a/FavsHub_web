import { afterEach, vi } from 'vitest'
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  watchEffect,
} from 'vue'

// Nuxt 自动导入的 Vue API 在独立 Vitest 进程中显式提供。
Object.assign(globalThis, {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
  watchEffect,
})

afterEach(() => {
  window.localStorage.clear()
  vi.unstubAllGlobals()
})
