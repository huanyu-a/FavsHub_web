<template>
  <div>
    <slot />
  </div>
</template>

<script setup lang="ts">
useHead({
  titleTemplate: (titleChunk) => {
    return titleChunk ? `${titleChunk} - FavsHub` : 'FavsHub - 智能书签管理'
  },
})
</script>
