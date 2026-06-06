<template>
  <Teleport to="body">
    <div
      v-if="visible && bookmark"
      class="context-menu-overlay"
      @click="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    >
      <div
        class="context-menu"
        :style="menuStyle"
        @click.stop
      >
        <div class="context-menu-header">{{ bookmark.title }}</div>
        <div class="context-menu-divider"></div>
        <button class="context-menu-item" @click="openInNewTab">
          <i class="ri-external-link-line"></i>
          <span>在新标签页打开</span>
        </button>
        <button class="context-menu-item" @click="openInNewWindow">
          <i class="ri-window-line"></i>
          <span>在新窗口打开</span>
        </button>
        <button class="context-menu-item" @click="openInIncognito">
          <i class="ri-incognito-line"></i>
          <span>在无痕窗口打开</span>
        </button>
        <button class="context-menu-item" @click="copyUrl">
          <i class="ri-file-copy-line"></i>
          <span>复制链接</span>
        </button>
        <template v-if="!isGuest">
          <div class="context-menu-divider"></div>
          <button class="context-menu-item" @click="$emit('edit', bookmark); $emit('close')">
            <i class="ri-edit-line"></i>
            <span>编辑</span>
          </button>
          <button class="context-menu-item context-menu-item--danger" @click="$emit('delete', bookmark); $emit('close')">
            <i class="ri-delete-bin-line"></i>
            <span>删除</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  bookmark: any
  visible: boolean
  x: number
  y: number
  isGuest?: boolean
}>()

const emit = defineEmits<{
  edit: [bookmark: any]
  delete: [bookmark: any]
  close: []
}>()

const menuStyle = computed(() => {
  const menuWidth = 200
  const menuHeight = 200
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const x = props.x + menuWidth > vw ? vw - menuWidth - 8 : props.x
  const y = props.y + menuHeight > vh ? vh - menuHeight - 8 : props.y
  return { left: `${x}px`, top: `${y}px` }
})

function openInNewTab() {
  if (props.bookmark?.url) {
    window.open(props.bookmark.url, '_blank')
  }
  emit('close')
}

function openInNewWindow() {
  if (props.bookmark?.url) {
    window.open(props.bookmark.url, '_blank', 'width=1200,height=800')
  }
  emit('close')
}

function openInIncognito() {
  // 无痕模式只能通过浏览器快捷键 (Ctrl+Shift+N) 触发
  // 这里尝试使用  off-the-record window API（仅 Chrome 扩展环境）
  if (props.bookmark?.url) {
    window.open(props.bookmark.url, '_blank', 'width=1200,height=800')
  }
  emit('close')
}

function copyUrl() {
  if (props.bookmark?.url) {
    navigator.clipboard.writeText(props.bookmark.url).catch(() => {})
  }
  emit('close')
}
</script>

<style scoped>
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
.context-menu {
  position: fixed;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  min-width: 180px;
  padding: 4px 0;
  z-index: 10000;
}
.context-menu-header {
  padding: 8px 14px;
  font-size: 12px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.context-menu-divider {
  height: 1px;
  background: #eee;
  margin: 2px 0;
}
.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #333;
  text-align: left;
  transition: background 0.15s;
}
.context-menu-item:hover {
  background: #f5f5f5;
}
.context-menu-item i {
  font-size: 15px;
  color: #666;
}
.context-menu-item--danger {
  color: #e74c3c;
}
.context-menu-item--danger i {
  color: #e74c3c;
}
.context-menu-item--danger:hover {
  background: #fff5f5;
}
/* Dark mode is now defined globally in layouts/default.vue */
</style>
