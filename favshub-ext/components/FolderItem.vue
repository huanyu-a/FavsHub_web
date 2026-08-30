<script lang="ts" setup>
import { ChevronDownOutline, ChevronForwardOutline, FolderOpenOutline } from '@vicons/ionicons5';
import { getFaviconUrl, getBookmarkInitial, handleFaviconError } from '@/utils/favicon-display';
import { t } from '@/i18n';

interface Bookmark {
  id: number;
  title: string;
  url: string;
  folder_id: number | null;
}

interface FolderTreeNode {
  id: number;
  name: string;
  parent_id: number | null;
  children: FolderTreeNode[];
}

const props = defineProps<{
  folder: FolderTreeNode;
  bookmarks: Bookmark[];
  expandedIds: Set<number>;
  depth: number;
}>();

const emit = defineEmits<{
  toggle: [id: number];
  open: [url: string];
}>();

const isExpanded = computed(() => props.expandedIds.has(props.folder.id));
const folderBookmarks = computed(() => props.bookmarks.filter(b => b.folder_id === props.folder.id));
const hasContent = computed(() => props.folder.children.length > 0 || folderBookmarks.value.length > 0);
</script>

<template>
  <div class="overflow-hidden rounded-xl border bg-white transition-colors"
    :class="isExpanded ? 'border-sky-200 bg-sky-50/30' : 'border-slate-200'"
    :style="{ marginLeft: depth > 0 ? `${depth * 12}px` : '0' }"
  >
    <button
      type="button"
      class="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left"
      @click="emit('toggle', folder.id)"
    >
      <n-icon
        :component="isExpanded ? ChevronDownOutline : ChevronForwardOutline"
        size="14"
        class="shrink-0 text-slate-400"
      />
      <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-amber-500">
        <n-icon :component="FolderOpenOutline" size="14" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-medium text-slate-800">{{ folder.name }}</div>
      </div>
      <span v-if="folderBookmarks.length" class="text-xs text-slate-400">{{ folderBookmarks.length }}</span>
    </button>

    <div v-if="isExpanded" class="border-t border-slate-100 px-2 py-2 space-y-1">
      <!-- 子文件夹（递归） -->
      <FolderItem
        v-for="child in folder.children"
        :key="child.id"
        :folder="child"
        :bookmarks="bookmarks"
        :expanded-ids="expandedIds"
        :depth="depth + 1"
        @toggle="emit('toggle', $event)"
        @open="emit('open', $event)"
      />

      <!-- 书签 -->
      <div
        v-for="bookmark in folderBookmarks"
        :key="bookmark.id"
        class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-colors hover:bg-sky-50/70"
        @click="emit('open', bookmark.url)"
      >
        <img :src="getFaviconUrl(bookmark.url)" :alt="bookmark.title" class="h-4 w-4 shrink-0 rounded-sm" loading="lazy" @error="handleFaviconError($event)" />
        <div class="hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-sky-100 text-[10px] font-bold text-sky-600">{{ getBookmarkInitial(bookmark.title) }}</div>
        <span class="min-w-0 flex-1 truncate text-sm text-slate-700 hover:text-sky-600">{{ bookmark.title }}</span>
      </div>

      <div v-if="!hasContent" class="px-3 py-3 text-center text-xs text-slate-400">
        {{ t('ui.folder.empty') }}
      </div>
    </div>
  </div>
</template>
