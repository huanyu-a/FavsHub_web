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
        <div class="custom-context-menu-item" @click="openIncognito">
          <span class="material-icons"><i class="ri-user-heart-line"></i></span>
          <span>在无痕窗口打开</span>
        </div>
        <template v-if="!isGuest">
          <div class="custom-context-menu-divider"></div>
          <div class="custom-context-menu-item" @click="$emit('edit', bookmark); $emit('close')">
            <span class="material-icons"><i class="ri-edit-line"></i></span>
            <span>编辑</span>
          </div>
          <div class="custom-context-menu-item custom-context-menu-item--danger" @click="confirmDelete">
            <span class="material-icons"><i class="ri-delete-bin-line"></i></span>
            <span>删除</span>
          </div>
        </template>
        <div class="custom-context-menu-divider"></div>
        <div class="custom-context-menu-item" @click="copyUrl">
          <span class="material-icons"><i class="ri-file-copy-line"></i></span>
          <span>{{ copyLabel }}</span>
        </div>
        <div class="custom-context-menu-item" @click="showQrCode">
          <span class="material-icons"><i class="ri-qr-code-line"></i></span>
          <span>生成二维码</span>
        </div>
      </div>
    </div>

    <!-- 二维码弹窗 -->
    <div v-if="qrVisible" class="qr-overlay" @click.self="qrVisible = false">
      <div class="qr-modal">
        <div class="qr-header">
          <span class="qr-title">{{ bookmark?.title }}</span>
          <button class="qr-close" @click="qrVisible = false">&times;</button>
        </div>
        <div class="qr-body">
          <img :src="qrUrl" alt="QR Code" class="qr-image">
          <p class="qr-link">{{ bookmark?.url }}</p>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div v-if="deleteConfirmVisible" class="qr-overlay" @click.self="deleteConfirmVisible = false">
      <div class="qr-modal" style="max-width:360px;">
        <div class="qr-header">
          <span class="qr-title">确认删除</span>
          <button class="qr-close" @click="deleteConfirmVisible = false">&times;</button>
        </div>
        <div class="qr-body" style="text-align:center;">
          <p style="margin:8px 0 16px;color:#555;">确定要删除「{{ bookmark?.title }}」吗？</p>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button class="qr-btn-cancel" @click="deleteConfirmVisible = false">取消</button>
            <button class="qr-btn-danger" @click="executeDelete">删除</button>
          </div>
        </div>
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

const qrVisible = ref(false)
const copyLabel = ref('复制链接')
const deleteConfirmVisible = ref(false)

const menuStyle = computed(() => {
  const menuWidth = 260
  const menuHeight = 340
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1920
  const vh = typeof window !== 'undefined' ? window.innerHeight : 1080
  const x = props.x + menuWidth > vw ? vw - menuWidth - 8 : props.x
  const y = props.y + menuHeight > vh ? vh - menuHeight - 8 : props.y
  return { left: `${x}px`, top: `${y}px` }
})

const qrUrl = computed(() => {
  if (!props.bookmark?.url) return ''
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(props.bookmark.url)}`
})

function openInNewTab() {
  if (props.bookmark?.url) window.open(props.bookmark.url, '_blank')
  emit('close')
}

function openInNewWindow() {
  if (props.bookmark?.url) window.open(props.bookmark.url, '_blank', 'width=1200,height=800')
  emit('close')
}

function openIncognito() {
  // Web apps can't open true incognito windows; open a popup as closest equivalent
  if (props.bookmark?.url) window.open(props.bookmark.url, '_blank', 'width=1200,height=800,noopener,noreferrer')
  emit('close')
}

function copyUrl() {
  if (props.bookmark?.url) {
    navigator.clipboard.writeText(props.bookmark.url).then(() => {
      copyLabel.value = '已复制!'
      setTimeout(() => { copyLabel.value = '复制链接' }, 1500)
    }).catch(() => {})
  }
  emit('close')
}

function showQrCode() {
  qrVisible.value = true
  emit('close')
}

function confirmDelete() {
  deleteConfirmVisible.value = true
  emit('close')
}

function executeDelete() {
  emit('delete', props.bookmark)
  deleteConfirmVisible.value = false
}
</script>

<style scoped>
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

/* QR code modal */
.qr-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.qr-modal {
  background: #fff;
  border-radius: 12px;
  max-width: 320px;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  overflow: hidden;
}
.qr-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid #f0f0f0;
}
.qr-title { font-size: 14px; font-weight: 600; }
.qr-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
.qr-body { padding: 20px 18px; }
.qr-image { display: block; margin: 0 auto; width: 200px; height: 200px; }
.qr-link { font-size: 11px; color: #94a3b8; word-break: break-all; margin-top: 12px; text-align: center; }
.qr-btn-cancel { padding: 6px 16px; border: 1px solid #ddd; border-radius: 6px; background: #fff; cursor: pointer; font-size: 13px; }
.qr-btn-cancel:hover { background: #f5f5f5; }
.qr-btn-danger { padding: 6px 16px; border: none; border-radius: 6px; background: #e74c3c; color: #fff; cursor: pointer; font-size: 13px; }
.qr-btn-danger:hover { background: #c0392b; }
</style>
