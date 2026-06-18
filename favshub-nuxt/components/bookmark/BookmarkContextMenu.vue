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
        <template v-if="!isGuest && isOwn">
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
          <p style="margin:8px 0 16px;color:var(--text-secondary);">确定要删除「{{ bookmark?.title }}」吗？</p>
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
  isOwn?: boolean
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

