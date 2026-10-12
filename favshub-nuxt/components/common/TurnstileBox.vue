<script setup lang="ts">
/**
 * Cloudflare Turnstile 挂件（游客通道人机校验）
 *
 * 令牌**一次性且有效期 300s**：每次提交后（无论成败）都要调用 reset() 换新令牌，
 * 否则用户第二次提交必然拿到 timeout-or-duplicate。
 * 组件加载/渲染失败时 emit fail —— 父组件据此**挡住提交**（fail-closed，无降级通道），
 * 并可用 retry() 让访客重新加载挂件。
 */
const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{
  (e: 'success', token: string): void
  (e: 'expired'): void
  (e: 'fail', reason: string): void
}>()

const box = ref<HTMLElement | null>(null)
let api: any = null
let widgetId: string | null = null

async function mount() {
  try {
    api = await loadTurnstileScript()
  } catch (err: any) {
    emit('fail', err?.message || '人机验证组件加载失败')
    return
  }
  if (!box.value) return
  try {
    widgetId = api.render(box.value, {
      sitekey: props.siteKey,
      theme: 'auto',
      callback: (token: string) => emit('success', token),
      'expired-callback': () => emit('expired'),
      // code 是 Cloudflare 的错误码：110200 = 域名未授权（需在 Cloudflare 后台给挂件加域名），
      // 透传给父组件，UI 上能直接看出失败原因而不是笼统的加载失败
      'error-callback': (code?: string) => {
        console.warn('[Turnstile] 挂件报错:', code)
        emit('fail', `人机验证组件出错${code ? `（${code}）` : ''}`)
      },
    })
  } catch (err: any) {
    emit('fail', err?.message || '人机验证组件渲染失败')
  }
}

onMounted(mount)

/** 重置挂件并作废当前令牌（提交后必须调用） */
function reset() {
  if (api && widgetId) {
    try { api.reset(widgetId) } catch { /* 挂件可能已被移除，忽略 */ }
  }
}

/** 重新加载挂件：脚本加载失败时 loadTurnstileScript 已移除坏标签，可直接重试 */
function retry() {
  if (api && widgetId) {
    try { api.remove(widgetId) } catch { /* 忽略 */ }
  }
  widgetId = null
  if (box.value) box.value.innerHTML = ''
  mount()
}

onBeforeUnmount(() => {
  if (api && widgetId) {
    try { api.remove(widgetId) } catch { /* 忽略 */ }
  }
})

defineExpose({ reset, retry })
</script>

<template>
  <div ref="box" class="turnstile-box"></div>
</template>

<style scoped>
.turnstile-box {
  min-height: 65px;
}
</style>
