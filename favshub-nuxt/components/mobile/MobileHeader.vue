<template>
  <div v-if="isMobile" class="mobile-header-bar">
    <NuxtLink to="/" class="sidebar-brand-card" title="主页">
      <img src="/images/logo.svg" alt="FavsHub" class="sidebar-brand-logo">
      <div class="sidebar-brand-copy">
        <span class="sidebar-brand-title">FavsHub</span>
        <span class="sidebar-brand-subtitle">Workspace</span>
      </div>
    </NuxtLink>
    <div class="mobile-header-actions">
      <button class="mobile-hamburger-btn" type="button" aria-label="Toggle menu" @click="toggleDrawer">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const { isMobile, toggleDrawer } = useMobile()
</script>
