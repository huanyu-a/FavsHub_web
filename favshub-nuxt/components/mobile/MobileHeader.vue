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
      <template v-if="mobileActionsSlot">
        <component :is="mobileActionsSlot" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
const { isMobile, mobileActionsSlot } = useMobile()
</script>
