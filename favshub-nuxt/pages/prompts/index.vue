<template>
  <div class="prompts-page">
    <header class="page-header">
      <h1 class="page-title">提示词管理</h1>
      <div class="header-actions">
        <SearchBar v-model="searchQuery" placeholder="搜索提示词..." @search="onSearch" />
      </div>
    </header>

    <div v-if="isLoading" class="loading">加载中...</div>
    <div v-else-if="prompts.length === 0" class="empty">
      <p>暂无提示词</p>
    </div>
    <div v-else class="prompts-grid">
      <div v-for="prompt in filteredPrompts" :key="prompt.id" class="prompt-card">
        <div class="prompt-header">
          <h3 class="prompt-title">{{ prompt.title }}</h3>
          <span v-if="prompt.category" class="prompt-category">{{ prompt.category }}</span>
        </div>
        <p class="prompt-content">{{ prompt.content }}</p>
        <div class="prompt-footer">
          <span class="prompt-date">{{ formatDate(prompt.created_at) }}</span>
          <div class="prompt-actions">
            <button class="btn-copy" @click="copyPrompt(prompt.content)" title="复制">📋</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import SearchBar from '~/components/search/SearchBar.vue'

interface Prompt {
  id: number
  title: string
  content: string
  category?: string
  created_at?: number
}

const { data, pending: isLoading } = await useFetch<{ prompts: Prompt[] }>('/api/prompts')

const prompts = computed(() => data.value?.prompts || [])
const searchQuery = ref('')

const filteredPrompts = computed(() => {
  if (!searchQuery.value) return prompts.value
  const q = searchQuery.value.toLowerCase()
  return prompts.value.filter(
    (p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)
  )
})

function onSearch(query: string) {
  searchQuery.value = query
}

function copyPrompt(content: string) {
  if (import.meta.client) {
    navigator.clipboard.writeText(content)
  }
}

function formatDate(ts?: number) {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.prompts-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.header-actions {
  flex: 1;
  max-width: 400px;
  min-width: 200px;
}
.prompts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.prompt-card {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  padding: 16px;
  transition: box-shadow 0.2s;
}
.prompt-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.prompt-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.prompt-category {
  font-size: 11px;
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 10px;
}
.prompt-content {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  margin: 0 0 12px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.prompt-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.prompt-date {
  font-size: 11px;
  color: #aaa;
}
.prompt-actions {
  display: flex;
  gap: 4px;
}
.btn-copy {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
}
.btn-copy:hover {
  background: rgba(0, 0, 0, 0.06);
}
.loading,
.empty {
  text-align: center;
  padding: 60px 20px;
  color: #999;
  font-size: 14px;
}
@media (prefers-color-scheme: dark) {
  .page-title,
  .prompt-title {
    color: #eee;
  }
  .prompt-card {
    background: #1e1e1e;
    border-color: #333;
  }
  .prompt-card:hover {
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  }
  .prompt-content {
    color: #aaa;
  }
  .prompt-category {
    background: #1a3a5c;
    color: #64b5f6;
  }
  .btn-copy:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}
</style>
