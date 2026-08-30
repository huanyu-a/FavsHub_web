<script lang="ts" setup>
import { SearchOutline } from '@vicons/ionicons5';
import { t } from '@/i18n';

const modelValue = defineModel<string>({ default: '' });
</script>

<template>
  <div class="relative z-50 isolate">
    <n-input
      :value="modelValue"
      clearable
      :placeholder="t('ui.search.placeholder')"
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
