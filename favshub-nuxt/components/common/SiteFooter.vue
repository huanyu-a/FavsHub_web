<template>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <!-- 友情链接模块 -->
      <div v-if="friendLinks.length > 0" class="footer-section links-section">
        <div class="links-header">
          <div class="links-title">
            <i class="ri-links-line"></i>
            <span>友情链接</span>
          </div>
          <span class="links-hint">优质站点推荐与生态互联</span>
        </div>
        <div class="links-grid">
          <a
            v-for="link in friendLinks"
            :key="link.id"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="link-chip"
            :title="link.description ? `${link.name} - ${link.description}` : link.name"
          >
            <img
              v-if="link.logo"
              :src="link.logo"
              :alt="link.name"
              class="link-chip-logo"
              loading="lazy"
              @error="(e) => (e.target as HTMLElement).style.display = 'none'"
            />
            <span v-else class="link-chip-icon"><i class="ri-global-line"></i></span>
            <span class="link-chip-name">{{ link.name }}</span>
            <span v-if="link.description" class="link-chip-desc">{{ link.description }}</span>
          </a>
        </div>
      </div>

      <!-- 底部版权、备案与声明 -->
      <div class="footer-bottom">
        <div class="footer-brand">
          <span class="brand-logo">
            <img src="/images/logo.svg" alt="FavsHub" class="brand-logo-img" />
            <strong class="brand-name">FavsHub</strong>
          </span>
          <span class="brand-desc">网址导航与智能书签管理工作台 · 发现全网高价值资源</span>
        </div>

        <div class="footer-links">
          <NuxtLink to="/" class="foot-nav-link">主页导航</NuxtLink>
          <span class="foot-dot">·</span>
          <NuxtLink to="/tokens" class="foot-nav-link">白嫖通告</NuxtLink>
          <span class="foot-dot">·</span>
          <NuxtLink to="/tokens/keys" class="foot-nav-link">福利 Key</NuxtLink>
          <span class="foot-dot">·</span>
          <NuxtLink to="/collections" class="foot-nav-link">精选集</NuxtLink>
          <span class="foot-dot">·</span>
          <NuxtLink to="/prompts" class="foot-nav-link">提示词库</NuxtLink>
          <span class="foot-dot">·</span>
          <a href="/tokens/eval/" class="foot-nav-link">评测看板</a>
        </div>

        <div class="footer-meta">
          <span class="meta-copyright">© {{ currentYear }} FavsHub. All Rights Reserved.</span>
          <span class="meta-tip">本站所有内容均由用户与网络公开信息聚合，仅供技术交流学习</span>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

interface FriendLinkItem {
  id: number
  name: string
  url: string
  logo?: string
  description?: string
  sort_order: number
}

const currentYear = new Date().getFullYear()
const friendLinks = ref<FriendLinkItem[]>([])

async function loadFriendLinks() {
  try {
    const res = await $fetch<{ code: number; data: FriendLinkItem[] }>('/api/friend-links')
    if (res.code === 200 && Array.isArray(res.data)) {
      friendLinks.value = res.data
    }
  } catch (err) {
    // 忽略前台静默失败
  }
}

onMounted(() => {
  loadFriendLinks()
})
</script>

<style scoped>
.site-footer {
  width: 100%;
  margin-top: auto;
  border-top: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 13px;
  position: relative;
  z-index: 10;
}

.site-footer-inner {
  max-width: 1360px;
  margin: 0 auto;
  padding: 32px 24px 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* 友情链接板块 */
.links-section {
  padding-bottom: 20px;
  border-bottom: 1px dashed var(--border);
}

.links-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.links-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.links-title i {
  color: var(--primary);
  font-size: 16px;
}

.links-hint {
  font-size: 12px;
  color: var(--text-tertiary);
}

.links-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.link-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  color: var(--text-primary);
  text-decoration: none;
  font-size: 13px;
  transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
  max-width: 280px;
}

.link-chip:hover {
  background: var(--surface-hover, var(--surface));
  border-color: var(--primary);
  color: var(--primary);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.link-chip-logo {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: contain;
  flex-shrink: 0;
}

.link-chip-icon {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  font-size: 14px;
  flex-shrink: 0;
}

.link-chip-name {
  font-weight: 500;
  white-space: nowrap;
}

.link-chip-desc {
  color: var(--text-tertiary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 1px solid var(--border);
  padding-left: 6px;
}

/* 底部信息 */
.footer-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.footer-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.brand-logo-img {
  width: 20px;
  height: 20px;
}

.brand-name {
  color: var(--text-primary);
  font-size: 15px;
  letter-spacing: -0.2px;
}

.brand-desc {
  font-size: 12px;
  color: var(--text-tertiary);
}

.footer-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.foot-nav-link {
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 13px;
  transition: color 0.15s ease;
}

.foot-nav-link:hover {
  color: var(--primary);
}

.foot-dot {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.footer-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .site-footer-inner {
    padding: 24px 16px 80px; /* 留出移动端底部导航空间 */
    gap: 18px;
  }
  .links-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .link-chip {
    max-width: 100%;
    flex: 1 1 calc(50% - 10px);
  }
  .link-chip-desc {
    display: none;
  }
  .footer-brand {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
