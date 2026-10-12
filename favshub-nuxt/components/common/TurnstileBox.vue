<script setup lang="ts">
/**
 * Cloudflare Turnstile 挂件（游客通道人机校验）
 *
 * 令牌**一次性且有效期 300s**：每次提交后（无论成败）都要调用 reset() 换新令牌，
 * 否则用户第二次提交必然拿到 timeout-or-duplicate。
 * 组件加载/渲染失败时 emit fail，父组件据此回落到算术题。
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

onMounted(async () => {
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
      'error-callback': () => emit('fail', '人机验证组件出错'),
    })
  } catch (err: any) {
    emit('fail', err?.message || '人机验证组件渲染失败')
  }
})

/** 重置挂件并作废当前令牌（提交后必须调用） */
function reset() {
  if (api && widgetId) {
    try { api.reset(widgetId) } catch { /* 挂件可能已被移除，忽略 */ }
  }
}

onBeforeUnmount(() => {
  if (api && widgetId) {
    try { api.remove(widgetId) } catch { /* 忽略 */ }
  }
})

defineExpose({ reset })
</script>

<template>
  <div ref="box" class="turnstile-box"></div>
</template>

<style scoped>
.turnstile-box {
  min-height: 65px;
}
</style>
