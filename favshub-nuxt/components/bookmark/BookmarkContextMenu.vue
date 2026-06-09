<template>
  <Teleport to="body">
    <div
      v-if="visible && bookmark"
      class="context-menu-overlay"
      @click="$emit('close')"
      @contextmenu.prevent="$emit('close')"
    >
      <div class="custom-context-menu" :style="menuStyle" style="display:block;" @click.stop>
        <div class="custom-context-menu-item" @click="openInNewTab">
          <span class="material-icons"><i class="ri-external-link-line"></i></span>
          <span>在新标签页打开</span>
        </div>
        <div class="custom-context-menu-item" @click="openInNewWindow">
          <span class="material-icons"><i class="ri-window-line"></i></span>
          <span>在新窗口打开</span>
        </div>
        <div class="custom-context-menu-item" @click="copyUrl">
          <span class="material-icons"><i class="ri-file-copy-line"></i></span>
          <span>复制链接</span>
        </div>
        <template v-if="!isGuest">
          <div class="custom-context-menu-divider"></div>
          <div class="custom-context-menu-item" @click="$emit('edit', bookmark); $emit('close')">
            <span class="material-icons"><i class="ri-edit-line"></i></span>
            <span>编辑</span>
          </div>
          <div class="custom-context-menu-item custom-context-menu-item--danger" @click="$emit('delete', bookmark); $emit('close')">
            <span class="material-icons"><i class="ri-delete-bin-line"></i></span>
            <span>删除</span>
          </div>
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
  const menuWidth = 260
  const menuHeight = 240
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const x = props.x + menuWidth > vw ? vw - menuWidth - 8 : props.x
  const y = props.y + menuHeight > vh ? vh - menuHeight - 8 : props.y
  return { left: `${x}px`, top: `${y}px` }
})

function openInNewTab() {
  if (props.bookmark?.url) window.open(props.bookmark.url, '_blank')
  emit('close')
}

function openInNewWindow() {
  if (props.bookmark?.url) window.open(props.bookmark.url, '_blank', 'width=1200,height=800')
  emit('close')
}

function copyUrl() {
  if (props.bookmark?.url) navigator.clipboard.writeText(props.bookmark.url).catch(() => {})
  emit('close')
}
</script>

<style scoped>
/* .custom-context-menu / .custom-context-menu-item / .custom-context-menu-divider /
   .material-icons 样式均来自 main-bundle.css。 */
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
.custom-context-menu-item {
  display: flex;
  align-items: center;
}
.custom-context-menu-item .material-icons {
  margin-right: 8px;
  font-size: 18px;
  color: #717882;
  display: inline-flex;
  align-items: center;
}
.custom-context-menu-item--danger { color: #e74c3c; }
.custom-context-menu-item--danger .material-icons { color: #e74c3c; }
</style>
