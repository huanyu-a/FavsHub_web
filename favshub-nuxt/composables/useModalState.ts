import { computed, ref } from 'vue'

/**
 * 全局「当前有哪些模态弹窗开着」状态。
 *
 * 用途：隐藏右下角悬浮件（公告 FAB / 移动端搜索按钮 / 回到顶部）。
 * 它们的 z-index（10004 / 999999）高于各类弹窗（10000~10080），
 * 不隐藏就会压在弹窗内容之上（2026-11-27 用户实测反馈）。
 *
 * 为什么用响应式状态而不是 body class：
 * 外部 CSS 文件靠 `?v=` 版本号刷新缓存，漏改版本号时规则不生效
 * （当天实测：CSS 已加载但匹配规则为空）。状态驱动不依赖缓存。
 *
 * 用「键集合」而不是计数器：组件异常卸载时不会把计数留在非零，
 * 重复 open 同一个键也不会叠加。
 */
const openModals = ref(new Set<string>())

const isAnyModalOpen = computed(() => openModals.value.size > 0)

export function useModalState() {
  function showModal(key: string) {
    const next = new Set(openModals.value)
    next.add(key)
    openModals.value = next
  }

  function hideModal(key: string) {
    const next = new Set(openModals.value)
    next.delete(key)
    openModals.value = next
  }

  return { isAnyModalOpen, showModal, hideModal }
}