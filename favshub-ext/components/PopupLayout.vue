<script setup lang="ts">
// 弹窗模式固定 400×600；作为侧边栏打开时（URL 带 context=side_panel，
// 或窗口高度明显超过 popup 固定高度）自适应全宽全高
const isSidePanel =
  new URLSearchParams(window.location.search).get('context') === 'side_panel' ||
  window.innerHeight > 640;
</script>

<template>
  <div
    class="flex flex-col overflow-hidden bg-slate-50 text-slate-900"
    :class="isSidePanel ? 'h-screen w-full' : 'h-[600px] w-[400px] max-h-screen'"
  >
    <slot />
  </div>
</template>
