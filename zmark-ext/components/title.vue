<script lang="ts" setup>
defineProps<{
  title: string;
}>();
</script>

<template>
  <header class="shrink-0 border-b border-slate-200 bg-white/95 px-4 backdrop-blur">
    <div class="grid h-12 grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div />
      <h1 class="text-center text-[15px] font-semibold text-slate-900">{{ title }}</h1>
      <div class="flex justify-end">
        <slot name="right" />
      </div>
    </div>
  </header>
</template>
