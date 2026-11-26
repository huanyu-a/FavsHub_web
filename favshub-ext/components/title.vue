<script lang="ts" setup>
defineProps<{
  title: string;
}>();
</script>

<template>
  <header class="shrink-0 border-b border-stone-200/90 bg-white/90 backdrop-blur">
    <div class="grid h-14 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4">
      <div class="flex items-center gap-2">
        <span class="fh-brand-mark fh-brand-mark--sm" aria-hidden="true">F</span>
        <span class="text-[11px] font-semibold tracking-[0.12em] text-stone-500">FAVSHUB</span>
      </div>
      <h1 class="text-center text-[15px] font-semibold tracking-[-0.01em] text-stone-900">{{ title }}</h1>
      <div class="flex justify-end">
        <slot name="right" />
      </div>
    </div>
  </header>
</template>
