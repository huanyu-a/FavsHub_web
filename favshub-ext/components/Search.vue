<script lang="ts" setup>
import { SearchOutline } from '@vicons/ionicons5';

const modelValue = defineModel<string>({ default: '' });

function openLink(url: string) {
  chrome.tabs.create({ url });
}
</script>

<template>
  <div class="relative z-50 isolate">
    <n-input
      :value="modelValue"
      clearable
      placeholder="输入书签关键词进行搜索"
      round
      size="large"
      @update:value="modelValue = $event"
    >
      <template #prefix>
        <n-icon :component="SearchOutline" class="text-slate-400" />
      </template>
    </n-input>
  </div>
</template>
