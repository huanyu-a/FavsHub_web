<template>
  <NuxtLink :to="`/collections/${collection.id}`" class="collection-card" :style="{ ...collectionCoverStyle(collection.id), '--stagger': String(staggerIndex % 12) }">
    <div class="collection-cover">
      <span class="cover-orb" aria-hidden="true"></span>
      <span class="cover-grid" aria-hidden="true"></span>
      <span v-if="collection.is_official" class="official-badge"><i class="ri-verified-badge-fill"></i> 官方精选</span>
      <span class="collection-icon-wrap">
        <AppIcon :value="collection.icon" fallback="ri-book-2-line" class="collection-icon" />
      </span>
    </div>
    <div class="collection-body">
      <h3 class="collection-name">{{ collection.name }}</h3>
      <p class="collection-desc">{{ collection.description || '暂无描述' }}</p>
      <div class="collection-meta">
        <span class="meta-chip"><i class="ri-bookmark-line"></i>{{ collection.bookmark_count }} 条书签</span>
        <span class="meta-chip"><i class="ri-user-3-line"></i>{{ collection.username || '匿名' }}</span>
      </div>
      <div class="collection-actions" @click.stop.prevent>
        <button class="btn-subscribe" :class="{ subscribed: isSubscribed }" :disabled="subscribing" @click="toggleSubscribe">
          <i :class="isSubscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'"></i>
          {{ isSubscribed ? '已订阅' : '订阅' }}
        </button>
        <button class="btn-import" :disabled="importing" @click="quickImport">
          <i :class="importing ? 'ri-loader-4-line spin' : 'ri-download-cloud-2-line'"></i>
          {{ importing ? '导入中' : '一键导入' }}
        </button>
      </div>
    </div>
    <div v-if="msg" class="card-toast" :class="'card-toast-' + msgType">{{ msg }}</div>
  </NuxtLink>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { collectionCoverStyle } from '~/utils/collection-colors'

interface ICollection {
  id: string
  name: string
  description: string
  icon: string
  is_public: number
  is_official: number
  bookmark_count: number
  created_at: number
  username?: string
}

interface IImportResult {
  success: boolean
  imported: number
  skipped: number
  folder_id: string | null
  folder_name: string
  collection_name: string
}

const props = defineProps<{
  collection: ICollection
  staggerIndex?: number
}>()

const importing = ref(false)
const subscribing = ref(false)
const isSubscribed = ref(false)
const msg = ref('')
const msgType = ref<'success' | 'error'>('success')
let msgTimer: ReturnType<typeof setTimeout>

// 检查订阅状态
async function checkSubscribeStatus() {
  try {
    const authStore = useAuthStore()
    if (!authStore.isLoggedIn) return
    const res = await $fetch<any>(`/api/collections/${props.collection.id}/status`)
    isSubscribed.value = res.is_subscribed
  } catch { /* ignore */ }
}

// 组件初始化时检查
checkSubscribeStatus()

async function toggleSubscribe() {
  if (subscribing.value) return
  subscribing.value = true
  try {
    if (isSubscribed.value) {
      await $fetch(`/api/collections/${props.collection.id}/subscribe`, { method: 'DELETE' })
      isSubscribed.value = false
      showToast('已取消订阅', 'success')
    } else {
      await $fetch(`/api/collections/${props.collection.id}/subscribe`, { method: 'POST' })
      isSubscribed.value = true
      showToast('订阅成功', 'success')
    }
  } catch (err: any) {
    showToast(err?.data?.error || '操作失败', 'error')
  } finally {
    subscribing.value = false
  }
}

function showToast(text: string, type: 'success' | 'error') {
  msg.value = text
  msgType.value = type
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => { msg.value = '' }, 2500)
}

onUnmounted(() => clearTimeout(msgTimer))

async function quickImport() {
  if (importing.value) return
  importing.value = true
  try {
    const res = await $fetch<IImportResult>(`/api/collections/${props.collection.id}/import`, {
      method: 'POST',
      body: { mode: 'all' },
    })
    showToast(`成功导入 ${res.imported} 条书签${res.skipped ? `（跳过 ${res.skipped} 条重复）` : ''}`, 'success')
  } catch (err: any) {
    showToast(err?.data?.error || '导入失败', 'error')
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.collection-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 14px;
  background: var(--surface-raised, #fff);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  position: relative;
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.25s, border-color 0.25s;
  animation: card-enter 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--stagger, 0) * 45ms);
}
@keyframes card-enter {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .collection-card { animation: none; }
}
.collection-card:hover {
  transform: translateY(-4px);
  border-color: hsl(var(--cover-hue, 160) 72% 58% / 0.55);
  box-shadow:
    0 12px 32px -12px hsl(var(--cover-hue, 160) 72% 45% / 0.45),
    var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
}

/* ── 渐变封面 ── */
.collection-cover {
  position: relative;
  height: 72px;
  background: linear-gradient(135deg, var(--cover-c1, #10b981), var(--cover-c2, #0d9488));
  overflow: hidden;
}
.cover-orb {
  position: absolute;
  width: 130px;
  height: 130px;
  right: -34px;
  top: -58px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.34), transparent 66%);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}
.cover-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.09) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.09) 1px, transparent 1px);
  background-size: 22px 22px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.9), transparent);
  -webkit-mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.9), transparent);
}
.collection-card:hover .cover-orb { transform: scale(1.28) translateX(-8px); }
.collection-icon-wrap {
  position: absolute;
  left: 14px;
  bottom: -18px;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #fff;
  background: rgba(255, 255, 255, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.35);
  backdrop-filter: blur(6px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.16);
  transition: transform 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.collection-card:hover .collection-icon-wrap { transform: scale(1.08) rotate(-3deg); }
.collection-icon {
  font-style: normal;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.2));
}
.official-badge {
  position: absolute;
  right: 10px;
  top: 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.38);
  backdrop-filter: blur(6px);
  letter-spacing: 0.01em;
}

/* ── 内容区 ── */
.collection-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 24px 14px 12px;
}
.collection-name {
  margin: 0 0 5px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-desc {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  min-height: 38px;
}
.collection-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.meta-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
}
.meta-chip i { font-size: 12px; }
.collection-actions {
  display: flex;
  gap: 8px;
}
.btn-subscribe {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-subscribe:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
}
.btn-subscribe.subscribed {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
}
.btn-subscribe:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-import {
  flex: 1;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 72%, #000));
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s;
  box-shadow: 0 2px 8px -2px color-mix(in srgb, var(--primary) 55%, transparent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.btn-import:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
  box-shadow: 0 5px 14px -4px color-mix(in srgb, var(--primary) 65%, transparent);
}
.btn-import:active { transform: translateY(0); }
.btn-import:disabled { opacity: 0.6; cursor: not-allowed; }
.card-toast {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  color: #fff;
  z-index: 10;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
.card-toast-success { background: var(--success, #10b981); }
.card-toast-error { background: var(--danger, #ef4444); }
</style>
