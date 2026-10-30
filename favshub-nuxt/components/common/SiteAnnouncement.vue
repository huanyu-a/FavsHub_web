<template>
  <div class="announcement-widget">
    <!-- 右侧悬浮图标 -->
    <div
      v-if="announcements.length > 0"
      class="announcement-fab"
      :class="{ 'has-unread': unreadCount > 0 }"
      title="站点公告"
      @click="openModal"
    >
      <div class="fab-icon-wrap">
        <i class="ri-notification-3-line fab-icon"></i>
        <!-- 公告数量 Badge -->
        <span v-if="displayCount > 0" class="fab-badge" :class="{ 'badge-unread': unreadCount > 0 }">
          {{ displayCount > 99 ? '99+' : displayCount }}
        </span>
      </div>
      <span class="fab-tooltip">站点公告</span>
    </div>

    <!-- 弹窗遮罩与主体 -->
    <Teleport to="body">
      <Transition name="ann-fade">
        <div
          v-if="isOpen"
          class="ann-overlay"
          @click.self="closeModal"
        >
          <div class="ann-modal" :class="{ 'is-detail': currentView === 'detail' }">
            <!-- 弹窗顶栏 -->
            <div class="ann-header">
              <div class="ann-header-left">
                <button
                  v-if="currentView === 'detail'"
                  class="ann-back-btn"
                  title="返回公告列表"
                  @click="backToList"
                >
                  <i class="ri-arrow-left-line"></i>
                  <span>返回列表</span>
                </button>
                <div v-else class="ann-header-title">
                  <i class="ri-megaphone-line"></i>
                  <span>站点公告</span>
                  <span class="ann-count-tag">{{ announcements.length }} 篇</span>
                </div>
              </div>

              <div class="ann-header-right">
                <button
                  v-if="currentView === 'list' && unreadCount > 0"
                  class="ann-action-btn"
                  title="标记全部为已读"
                  @click="markAllAsRead"
                >
                  <i class="ri-check-double-line"></i> 全部已读
                </button>
                <button class="ann-close-btn" title="关闭" @click="closeModal">&times;</button>
              </div>
            </div>

            <!-- 弹窗主体：列表视图 -->
            <div v-if="currentView === 'list'" class="ann-body ann-list-view">
              <div v-if="announcements.length === 0" class="ann-empty">
                <i class="ri-inbox-line"></i>
                <p>暂无新公告</p>
              </div>
              <div v-else class="ann-list">
                <div
                  v-for="item in announcements"
                  :key="item.id"
                  class="ann-card"
                  :class="{ 'is-unread': !isRead(item.id), 'is-pinned': item.pinned }"
                  @click="viewDetail(item)"
                >
                  <div class="card-head">
                    <span v-if="item.pinned" class="card-pin">
                      <i class="ri-pushpin-2-fill"></i> 置顶
                    </span>
                    <span v-if="!isRead(item.id)" class="unread-dot" title="未读公告"></span>
                    <h4 class="card-title">{{ item.title }}</h4>
                  </div>
                  <p class="card-snippet">{{ getSnippet(item.content) }}</p>
                  <div class="card-foot">
                    <span class="card-time">
                      <i class="ri-calendar-line"></i> {{ formatDate(item.created_at) }}
                    </span>
                    <span class="card-more">查看详情 <i class="ri-arrow-right-s-line"></i></span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 弹窗主体：详情视图 -->
            <div v-else-if="currentView === 'detail' && activeAnnouncement" class="ann-body ann-detail-view">
              <div class="detail-header">
                <div class="detail-meta">
                  <span v-if="activeAnnouncement.pinned" class="detail-pin">
                    <i class="ri-pushpin-2-fill"></i> 置顶公告
                  </span>
                  <span class="detail-time">
                    <i class="ri-calendar-line"></i> 发布于 {{ formatDate(activeAnnouncement.created_at) }}
                  </span>
                </div>
                <h2 class="detail-title">{{ activeAnnouncement.title }}</h2>
              </div>

              <!-- 富文本/Markdown/图片渲染区域 -->
              <div class="detail-content markdown-body" v-html="renderedDetail"></div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { marked } from 'marked'

interface AnnouncementItem {
  id: number
  title: string
  content: string
  content_type: 'markdown' | 'html'
  pinned: number | boolean
  created_at: number
  updated_at: number
}

const STORAGE_KEY = 'favshub_announcements_read_ids'

const announcements = ref<AnnouncementItem[]>([])
const readIds = ref<number[]>([])
const isOpen = ref(false)
const currentView = ref<'list' | 'detail'>('list')
const activeAnnouncement = ref<AnnouncementItem | null>(null)

// 计算未读数量与展示数量
const unreadCount = computed(() => {
  return announcements.value.filter(a => !readIds.value.includes(a.id)).length
})

const displayCount = computed(() => {
  return unreadCount.value > 0 ? unreadCount.value : announcements.value.length
})

function isRead(id: number): boolean {
  return readIds.value.includes(id)
}

function loadReadIds() {
  if (import.meta.client) {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        readIds.value = JSON.parse(stored)
      }
    } catch {
      readIds.value = []
    }
  }
}

function saveReadIds() {
  if (import.meta.client) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readIds.value))
    } catch {
      // ignore
    }
  }
}

function markAsRead(id: number) {
  if (!readIds.value.includes(id)) {
    readIds.value.push(id)
    saveReadIds()
  }
}

function markAllAsRead() {
  readIds.value = announcements.value.map(a => a.id)
  saveReadIds()
}

async function loadAnnouncements() {
  try {
    const res = await $fetch<{ code: number; data: AnnouncementItem[] }>('/api/announcements')
    if (res.code === 200 && Array.isArray(res.data)) {
      announcements.value = res.data
    }
  } catch (err) {
    // 静默兜底
  }
}

function openModal() {
  currentView.value = 'list'
  isOpen.value = true
}

function closeModal() {
  isOpen.value = false
}

function viewDetail(item: AnnouncementItem) {
  activeAnnouncement.value = item
  currentView.value = 'detail'
  markAsRead(item.id)
}

function backToList() {
  currentView.value = 'list'
  activeAnnouncement.value = null
}

function getSnippet(content: string): string {
  if (!content) return ''
  // 简易过滤 Markdown / HTML 标签取得纯文本片段
  const plain = content
    .replace(/<[^>]+>/g, '')
    .replace(/[#*`_~>[\]()!-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 80 ? plain.slice(0, 80) + '...' : plain
}

function formatDate(ts?: number) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const renderedDetail = computed(() => {
  if (!activeAnnouncement.value) return ''
  const raw = activeAnnouncement.value.content || ''
  try {
    // marked 默认将 Markdown 编译为 HTML，并允许内嵌的原生 HTML 与 img 标签
    return marked.parse(raw, {
      async: false,
      gfm: true,
      breaks: true,
    }) as string
  } catch (err: any) {
    return `<p>${raw}</p>`
  }
})

onMounted(() => {
  loadReadIds()
  loadAnnouncements()
})
</script>

<style scoped>
/* 悬浮图标 */
.announcement-widget {
  position: relative;
}

.announcement-fab {
  position: fixed;
  right: 24px;
  bottom: 120px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 990;
  transition: all 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  color: var(--text-primary);
}

.announcement-fab:hover {
  transform: translateY(-2px) scale(1.05);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  border-color: var(--primary);
  color: var(--primary);
}

.announcement-fab.has-unread {
  border-color: color-mix(in srgb, var(--primary) 60%, var(--border));
}

.fab-icon-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.fab-icon {
  font-size: 22px;
}

/* 数量角标 Badge */
.fab-badge {
  position: absolute;
  top: -10px;
  right: -12px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--surface);
  line-height: 1;
}

.fab-badge.badge-unread {
  background: var(--danger, #ef4444);
  color: #fff;
  animation: pulse-badge 2s infinite;
}

@keyframes pulse-badge {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.fab-tooltip {
  position: absolute;
  right: 56px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateX(4px);
  transition: all 0.15s ease;
}

.announcement-fab:hover .fab-tooltip {
  opacity: 1;
  transform: translateX(0);
}

/* 弹窗遮罩 */
.ann-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 16px;
}

/* 弹窗容器 */
.ann-modal {
  width: 580px;
  max-width: 100%;
  max-height: 80vh;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}

.ann-modal.is-detail {
  width: 680px;
}

/* 顶栏 */
.ann-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.ann-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ann-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.ann-header-title i {
  color: var(--primary);
  font-size: 18px;
}

.ann-count-tag {
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 10px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
}

.ann-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background-color 0.12s ease;
}

.ann-back-btn:hover {
  background: var(--surface-sunken);
}

.ann-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ann-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.12s ease;
}

.ann-action-btn:hover {
  color: var(--primary);
  background: var(--surface-sunken);
}

.ann-close-btn {
  background: none;
  border: none;
  font-size: 22px;
  color: var(--text-tertiary);
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
  transition: color 0.12s ease;
}

.ann-close-btn:hover {
  color: var(--text-primary);
}

/* 主体内容 */
.ann-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* 列表视图 */
.ann-empty {
  text-align: center;
  padding: 48px 0;
  color: var(--text-tertiary);
}

.ann-empty i {
  font-size: 40px;
  margin-bottom: 8px;
}

.ann-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ann-card {
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ann-card:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.ann-card.is-pinned {
  border-left: 3px solid var(--primary);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.card-pin {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.unread-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--danger, #ef4444);
  flex-shrink: 0;
}

.card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.card-snippet {
  margin: 0 0 10px 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-tertiary);
}

.card-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.card-more {
  display: inline-flex;
  align-items: center;
  color: var(--primary);
  font-weight: 500;
}

/* 详情视图 */
.detail-header {
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.detail-pin {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  padding: 2px 7px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.detail-time {
  font-size: 12px;
  color: var(--text-tertiary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.detail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.4;
}

/* Markdown 与富文本样式 */
.detail-content {
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.7;
}

.detail-content :deep(h1),
.detail-content :deep(h2),
.detail-content :deep(h3),
.detail-content :deep(h4) {
  margin-top: 18px;
  margin-bottom: 10px;
  color: var(--text-primary);
}

.detail-content :deep(p) {
  margin-bottom: 12px;
}

.detail-content :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.detail-content :deep(ul),
.detail-content :deep(ol) {
  padding-left: 22px;
  margin-bottom: 12px;
}

.detail-content :deep(li) {
  margin-bottom: 4px;
}

.detail-content :deep(blockquote) {
  border-left: 3px solid var(--primary);
  margin: 14px 0;
  padding: 8px 16px;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface-sunken));
  border-radius: 0 8px 8px 0;
  color: var(--text-secondary);
}

.detail-content :deep(code) {
  background: var(--surface-sunken);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: monospace;
}

.detail-content :deep(pre) {
  background: var(--surface-sunken);
  padding: 14px;
  border-radius: 8px;
  overflow-x: auto;
  border: 1px solid var(--border);
  margin-bottom: 14px;
}

.detail-content :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  margin: 12px auto;
  display: block;
  object-fit: contain;
}

.detail-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 14px;
}

.detail-content :deep(th),
.detail-content :deep(td) {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}

.detail-content :deep(th) {
  background: var(--surface-sunken);
  font-weight: 600;
}

/* 动效 */
.ann-fade-enter-active,
.ann-fade-leave-active {
  transition: opacity 0.2s ease;
}

.ann-fade-enter-from,
.ann-fade-leave-to {
  opacity: 0;
}

/* ── 移动端避让「回到顶部」按钮（2026-10-30）──────────────────────
   #back-to-top-container 在 ≤1024px 时 bottom: calc(80px + safe-area)，
   其内按钮为 50×50 + margin:32px → 按钮实际占据「下 112–162px、右 32–82px」，
   且容器 z-index:10004 远高于本组件 FAB 的 990，重叠时 FAB 会被盖住且点击无效。
   因此 FAB 必须整体叠到按钮**上方**：bottom ≥ 162px + 间距；
   同时把水平中心对齐到按钮中心（距离右缘 57px），视觉上形成一列。 */
@media (max-width: 1024px) {
  .announcement-fab {
    right: 33px; /* 57 - 48/2 */
    bottom: calc(176px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 768px) {
  .announcement-fab {
    right: 35px; /* 57 - 44/2 */
    bottom: calc(176px + env(safe-area-inset-bottom, 0px));
    width: 44px;
    height: 44px;
  }
  .ann-modal {
    width: 100%;
    max-height: 85vh;
  }
  .ann-modal.is-detail {
    width: 100%;
  }
  .detail-title {
    font-size: 18px;
  }
}
</style>
