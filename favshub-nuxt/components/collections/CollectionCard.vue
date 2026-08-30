<template>
  <NuxtLink :to="`/collections/${collection.id}`" class="collection-card">
    <div class="collection-card-header">
      <span class="collection-icon-wrap">
        <AppIcon :value="collection.icon" fallback="ri-book-2-line" class="collection-icon" />
      </span>
      <span v-if="collection.is_official" class="official-badge"><i class="ri-verified-badge-line"></i>官方</span>
    </div>
    <h3 class="collection-name">{{ collection.name }}</h3>
    <p class="collection-desc">{{ collection.description || '暂无描述' }}</p>
    <div class="collection-meta">
      <span class="meta-item"><i class="ri-bookmark-line"></i>{{ collection.bookmark_count }} 条书签</span>
      <span class="meta-sep"></span>
      <span class="meta-item"><i class="ri-user-3-line"></i>{{ collection.username || '匿名' }}</span>
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
  padding: 16px;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 12px;
  background: var(--surface-raised, #fff);
  text-decoration: none;
  color: inherit;
  position: relative;
  transition: border-color 0.18s, box-shadow 0.18s, transform 0.18s;
}
.collection-card:hover {
  border-color: color-mix(in srgb, var(--primary, #10b981) 40%, var(--border, #e5e7eb));
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.06));
  transform: translateY(-2px);
}
.collection-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}
.collection-icon-wrap {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary, #10b981) 9%, transparent);
}
.collection-icon { font-style: normal; }
.official-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  border: 1px solid var(--border);
  background: var(--surface-sunken);
}
.official-badge i { font-size: 12px; color: var(--accent-yellow, #f59e0b); }
.collection-name {
  margin: 0 0 5px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-desc {
  margin: 0 0 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
  min-height: 39px;
}
.collection-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.meta-item i { font-size: 13px; }
.meta-sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-tertiary);
  opacity: 0.5;
}
.collection-actions {
  display: flex;
  gap: 8px;
}
.btn-subscribe {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: color 0.18s, border-color 0.18s, background 0.18s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn-subscribe:hover {
  color: var(--primary);
  border-color: var(--primary);
}
.btn-subscribe.subscribed {
  color: var(--primary);
  border-color: color-mix(in srgb, var(--primary) 45%, transparent);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
}
.btn-subscribe:disabled { opacity: 0.6; cursor: not-allowed; }
.btn-import {
  flex: 1;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-inverse, #fff);
  background: var(--primary, #10b981);
  border: 1px solid var(--primary, #10b981);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.btn-import:hover {
  background: var(--primary-hover, #059669);
  border-color: var(--primary-hover, #059669);
}
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
