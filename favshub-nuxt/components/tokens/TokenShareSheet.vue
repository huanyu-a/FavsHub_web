<template>
  <Teleport to="body">
    <div class="tss-backdrop" @click.self="close">
      <div class="tss-modal" role="dialog" aria-modal="true" aria-label="分享通告卡片">
        <header class="tss-head">
          <h3 class="tss-title"><i class="ri-share-line"></i> 分享通告</h3>
          <button type="button" class="tss-close" title="关闭" @click="close">
            <i class="ri-close-line"></i>
          </button>
        </header>

        <div class="tss-body">
          <div v-if="loading" class="tss-state">
            <i class="ri-loader-4-line spin"></i>
            <p>正在生成卡片...</p>
          </div>
          <div v-else-if="error" class="tss-state is-err">
            <i class="ri-error-warning-line"></i>
            <p>{{ error }}</p>
            <button type="button" class="tss-btn ghost" @click="generate">重试</button>
          </div>
          <template v-else>
            <div class="tss-styles" role="tablist" aria-label="卡片风格">
              <button
                v-for="s in CARD_STYLES"
                :key="s.value"
                type="button"
                class="tss-style"
                :class="{ on: cardStyle === s.value }"
                role="tab"
                :aria-selected="cardStyle === s.value"
                @click="switchStyle(s.value)"
              >
                {{ s.label }}
              </button>
            </div>
            <div class="tss-preview">
              <img :src="previewUrl" :alt="`${deal.provider} 分享卡片`">
            </div>
            <p class="tss-hint">
              移动端可长按图片保存到相册；桌面端点击下方按钮下载（{{ SHARE_CARD_W }} × {{ SHARE_CARD_H }} PNG）。
            </p>
          </template>
        </div>

        <footer class="tss-foot">
          <button type="button" class="tss-btn ghost" @click="copyLink">
            <i class="ri-link"></i> 复制链接
          </button>
          <button
            type="button"
            class="tss-btn primary"
            :disabled="loading || !!error || !blob"
            @click="saveImage"
          >
            <i class="ri-download-2-line"></i>
            {{ saving ? '处理中...' : '保存图片' }}
          </button>
        </footer>

        <Transition name="toast">
          <div v-if="message" class="tss-toast" :class="messageType">{{ message }}</div>
        </Transition>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { fallbackProxyIcon } from '~/utils/favicon'
import {
  SHARE_CARD_W,
  SHARE_CARD_H,
  buildDealShareCanvas,
  buildShareUrl,
  canvasToBlob,
  makeQrDataUrl,
  shareFileName,
  type ShareDeal,
  type ShareCardStyle,
} from '~/utils/deal-share'

const CARD_STYLES: ReadonlyArray<{ value: ShareCardStyle; label: string }> = [
  { value: 'magazine', label: '杂志' },
  { value: 'neon', label: '终端' },
  { value: 'clay', label: '暖阳' },
]

const props = defineProps<{ deal: ShareDeal }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const saving = ref(false)
const error = ref('')
const previewUrl = ref('')
const blob = ref<Blob | null>(null)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
const cardStyle = ref<ShareCardStyle>('magazine')
let messageTimer: ReturnType<typeof setTimeout> | null = null

const iconUrl = fallbackProxyIcon('', props.deal.url) || ''

/** 分享地址用当前实际访问域名，避免 public.baseUrl 默认值（favshub.com）与线上域名不一致 */
function shareOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

function siteHost(): string {
  if (typeof window === 'undefined') return 'FavsHub'
  return window.location.host
}

function toast(text: string, type: 'ok' | 'err' = 'ok') {
  message.value = text
  messageType.value = type
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.value = '' }, 2600)
}

function revokePreview() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = ''
  }
}

/** 组件已卸载时丢弃异步产物，避免 blob URL 泄漏 */
let disposed = false

async function generate() {
  loading.value = true
  error.value = ''
  try {
    const url = buildShareUrl(props.deal.id, shareOrigin())
    const qrDataUrl = await makeQrDataUrl(url)
    const canvas = await buildDealShareCanvas(props.deal, {
      qrDataUrl,
      iconUrl,
      siteHost: siteHost(),
      style: cardStyle.value,
    })
    const next = await canvasToBlob(canvas)
    if (disposed) return
    blob.value = next
    revokePreview()
    previewUrl.value = URL.createObjectURL(next)
  } catch (err: any) {
    if (!disposed) error.value = err?.message || '卡片生成失败，请重试'
  } finally {
    if (!disposed) loading.value = false
  }
}

/** 切换卡片风格并重新生成（生成中不响应，避免竞态覆盖） */
function switchStyle(next: ShareCardStyle) {
  if (next === cardStyle.value || loading.value) return
  cardStyle.value = next
  generate()
}

/** iOS / iPadOS 不支持 a[download]，优先走系统分享（可「存储图像」到相册） */
function preferNativeShare(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return iOS && typeof navigator.canShare === 'function'
}

function canShareFile(file: File): boolean {
  try {
    return !!navigator.canShare?.({ files: [file] })
  } catch {
    return false
  }
}

/** 桌面 / 安卓：a[download] 直接落盘；不支持 download 属性时返回 false */
function downloadViaAnchor(url: string, filename: string): boolean {
  const a = document.createElement('a')
  if (!('download' in a)) return false
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  return true
}

async function saveImage() {
  if (!blob.value || saving.value) return
  saving.value = true
  try {
    const filename = shareFileName(props.deal.id, cardStyle.value)
    const file = new File([blob.value], filename, { type: 'image/png' })

    // 1. iOS：系统分享面板（「存储图像」即保存到相册）
    if (preferNativeShare() && canShareFile(file)) {
      try {
        await navigator.share({ files: [file], title: props.deal.title || 'FavsHub 通告' })
        return
      } catch (err: any) {
        if (err?.name === 'AbortError') return
      }
    }

    // 2. 桌面 / 安卓：直接下载
    if (downloadViaAnchor(previewUrl.value, filename)) {
      toast('已开始下载')
      return
    }

    // 3. 兜底：预览图本身支持长按保存
    toast('请长按图片保存到相册', 'err')
  } finally {
    saving.value = false
  }
}

async function copyLink() {
  const url = buildShareUrl(props.deal.id, shareOrigin())
  try {
    await navigator.clipboard.writeText(url)
    toast('详情链接已复制')
  } catch {
    toast('复制失败，请手动复制地址栏链接', 'err')
  }
}

function close() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let prevOverflow = ''

onMounted(() => {
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  generate()
})

onUnmounted(() => {
  disposed = true
  document.body.style.overflow = prevOverflow
  document.removeEventListener('keydown', onKeydown)
  if (messageTimer) clearTimeout(messageTimer)
  revokePreview()
})
</script>

<style scoped>
.tss-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
  animation: tss-fade 0.18s ease-out;
}
@keyframes tss-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.tss-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 420px;
  max-height: 92vh;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: tss-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes tss-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: none; }
}

.tss-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 0.5px solid var(--divider);
}
.tss-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.tss-title i { font-size: 16px; color: var(--text-tertiary); }
.tss-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-tertiary);
  font-size: 17px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tss-close:hover { background: var(--surface-hover); color: var(--text-primary); }

.tss-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
.tss-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.tss-state i { font-size: 22px; }
.tss-state p { margin: 0; text-align: center; }
.tss-state.is-err { color: var(--danger); }
.spin { animation: tss-spin 1s linear infinite; }
@keyframes tss-spin { to { transform: rotate(360deg); } }

.tss-preview {
  display: flex;
  justify-content: center;
}
.tss-styles {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 12px;
}
.tss-style {
  padding: 4px 16px;
  border-radius: 999px;
  border: 0.5px solid var(--border);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tss-style:hover { color: var(--text-primary); background: var(--surface-hover); }
.tss-style.on {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--surface-hover);
  font-weight: 500;
}
.tss-preview img {
  width: 100%;
  max-width: 300px;
  aspect-ratio: 3 / 4;
  object-fit: contain;
  border-radius: var(--radius-lg);
  border: 0.5px solid var(--border);
  background: var(--surface-sunken);
  user-select: none;
  -webkit-touch-callout: default;
}
.tss-hint {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  color: var(--text-tertiary);
}

.tss-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-top: 0.5px solid var(--divider);
}
.tss-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 14px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tss-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.tss-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.tss-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--text-inverse);
}
.tss-btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.tss-btn.ghost { flex: 0 0 auto; }

.tss-toast {
  position: absolute;
  left: 50%;
  bottom: 68px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--text-inverse);
  background: var(--text-primary);
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
}
.tss-toast.err { background: var(--danger); }
.toast-enter-active,
.toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(6px); }

@media (max-width: 640px) {
  .tss-backdrop { padding: 0; align-items: flex-end; }
  .tss-modal {
    max-width: none;
    max-height: 94vh;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .tss-preview img { max-width: 260px; }
}
</style>
