<template>
  <div v-if="isMobile" class="mobile-sidebar-overlay" :class="{ active: drawerOpen }" @click="closeDrawer"></div>
</template>

<script setup lang="ts">
const { isMobile, drawerOpen, closeDrawer } = useMobile()
</script>
