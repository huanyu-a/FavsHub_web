<template>
  <NuxtLink :to="`/collections/${collection.id}`" class="collection-card">
    <div class="collection-card-header">
      <span v-if="collection.icon" class="collection-icon"><AppIcon :value="collection.icon" fallback="ri-book-2-line" /></span>
      <span v-else class="collection-icon placeholder"><i class="ri-book-2-line"></i></span>
      <span v-if="collection.is_official" class="official-badge" title="官方推荐"><i class="ri-star-line"></i></span>
    </div>
    <h3 class="collection-name">{{ collection.name }}</h3>
    <p class="collection-desc">{{ collection.description || '暂无描述' }}</p>
    <div class="collection-meta">
      <span class="meta-item"><i class="ri-bookmark-line"></i> {{ collection.bookmark_count }} 条</span>
      <span class="meta-item"><i class="ri-user-line"></i> {{ collection.username || '匿名' }}</span>
    </div>
    <div class="collection-actions" @click.stop.prevent>
      <button class="btn-subscribe" :class="{ subscribed: isSubscribed }" :disabled="subscribing" @click="toggleSubscribe">
        <i :class="isSubscribed ? 'ri-bookmark-fill' : 'ri-bookmark-line'"></i>
        {{ isSubscribed ? '已订阅' : '订阅' }}
      </button>
      <button class="btn-import" :disabled="importing" @click="quickImport">{{ importing ? '导入中...' : '一键导入' }}</button>
    </div>
    <div v-if="msg" class="card-toast" :class="'card-toast-' + msgType">{{ msg }}</div>
  </NuxtLink>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

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
  padding: 12px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  background: var(--surface-raised, #fff);
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.15s;
  position: relative;
}
.collection-card:hover {
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05));
}
.collection-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.collection-icon {
  font-size: 18px;
}
.collection-icon.placeholder {
  opacity: 0.5;
}
.official-badge {
  font-size: 12px;
}
.collection-name {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}
.collection-meta {
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--text-tertiary, #9ca3af);
  margin-bottom: 8px;
}
.meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
}
.collection-actions {
  display: flex;
  gap: 6px;
}
.btn-subscribe {
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary, #6b7280);
  background: var(--surface-sunken, #f3f4f6);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-subscribe:hover {
  color: var(--primary, #10b981);
  border-color: var(--primary, #10b981);
}
.btn-subscribe.subscribed {
  color: var(--primary, #10b981);
  border-color: var(--primary, #10b981);
  background: color-mix(in srgb, var(--primary, #10b981) 10%, transparent);
}
.btn-subscribe:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-import {
  flex: 1;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--primary, #10b981);
  background: color-mix(in srgb, var(--primary, #10b981) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--primary, #10b981) 20%, transparent);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-import:hover {
  background: var(--primary, #10b981);
  color: #fff;
}
.btn-import:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
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
.card-toast-success {
  background: #10b981;
}
.card-toast-error {
  background: #ef4444;
}
</style>
