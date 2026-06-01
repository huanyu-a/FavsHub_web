<script lang="ts" setup>
import type { Component } from 'vue';
import { computed } from 'vue';
import { BookmarkOutline, AddCircleOutline, SyncOutline, SettingsOutline } from '@vicons/ionicons5';
import { useRoute, useRouter } from 'vue-router';

type NavItem = {
  key: string;
  label: string;
  icon: Component;
  to: string;
};

const items: NavItem[] = [
  { key: 'bookmarks', label: '书签', icon: BookmarkOutline, to: '/' },
  { key: 'add', label: '添加', icon: AddCircleOutline, to: '/add' },
  { key: 'sync', label: '同步', icon: SyncOutline, to: '/sync' },
  { key: 'settings', label: '设置', icon: SettingsOutline, to: '/settings' },
];

const route = useRoute();
const router = useRouter();

const currentRouteName = computed(() => String(route.name ?? 'bookmarks'));

function navigate(item: NavItem) {
  if (route.path === item.to) {
    return;
  }

  void router.push(item.to);
}
</script>

<template>
  <nav class="border-t border-slate-200 bg-white px-2 py-1 shadow-[0_-4px_12px_rgba(15,23,42,0.04)]">
    <ul class="grid grid-cols-4 gap-1">
      <li v-for="item in items" :key="item.key">
        <button
          type="button"
          class="flex w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs transition-colors"
          :class="currentRouteName === item.key ? 'bg-sky-50 text-sky-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'"
          @click="navigate(item)"
        >
          <n-icon :component="item.icon" size="18" />
          <span>{{ item.label }}</span>
        </button>
      </li>
    </ul>
  </nav>
</template>
