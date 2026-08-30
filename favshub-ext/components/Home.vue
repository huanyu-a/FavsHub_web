<script lang="ts" setup>
import {
  RefreshOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  FolderOpenOutline,
  CloudUploadOutline,
  LogInOutline,
} from '@vicons/ionicons5';
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import Search from '@/components/Search.vue';
import FolderItem from '@/components/FolderItem.vue';
import { request } from '@/utils/request';
import { baseUrlStorage, tokenStorage } from '@/utils/storage';
import { isSafeUrl } from '@/utils/safe-url';
import { getFaviconUrl, getBookmarkInitial, handleFaviconError } from '@/utils/favicon-display';
import { useRouter } from 'vue-router';
import { t } from '@/i18n';

interface Bookmark {
  id: number;
  title: string;
  url: string;
  folder_id: number | null;
}

interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
}

interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
}

interface BrowserBookmark {
  id: string;
  title: string;
  url?: string;
  children?: BrowserBookmark[];
  parentId?: string;
}

const message = useMessage();
const router = useRouter();
const bookmarks = ref<Bookmark[]>([]);
const folders = ref<Folder[]>([]);
const isLoading = ref(false);
const errorMessage = ref('');
const searchQuery = ref('');
const isSearching = computed(() => searchQuery.value.trim().length > 0);
const searchResults = computed<Bookmark[]>(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return [];
  return bookmarks.value.filter(
    (b) => (b.title || '').toLowerCase().includes(q) || (b.url || '').toLowerCase().includes(q)
  );
});
const expandedFolderIds = ref<Set<number>>(new Set());
const isLoggedIn = ref(false);
const showBrowserBookmarks = ref(false);
const browserBookmarks = ref<BrowserBookmark[]>([]);

// 构建文件夹树
const folderTree = computed<FolderTreeNode[]>(() => {
  const map = new Map<number, FolderTreeNode>();
  const roots: FolderTreeNode[] = [];
  for (const f of folders.value) {
    map.set(f.id, { ...f, children: [] });
  }
  for (const f of folders.value) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      map.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
});

function openLink(url: string) {
  if (!url || !isSafeUrl(url)) return;
  chrome.tabs.create({ url });
}

function getRootBookmarks() {
  return bookmarks.value.filter(b => !b.folder_id);
}

function toggleFolder(id: number) {
  const s = new Set(expandedFolderIds.value);
  if (s.has(id)) s.delete(id); else s.add(id);
  expandedFolderIds.value = s;
}

async function loadBookmarks() {
  isLoading.value = true;
  errorMessage.value = '';
  showBrowserBookmarks.value = false;

  try {
    const [token] = await Promise.all([tokenStorage.getValue()]);

    if (!token) {
      isLoggedIn.value = false;
      isLoading.value = false;
      return;
    }

    isLoggedIn.value = true;
    const result = await request<{ bookmarks: Bookmark[]; folders: Folder[] }>('/api/bookmarks');
    bookmarks.value = result.bookmarks ?? [];
    folders.value = result.folders ?? [];

    // 如果服务器没有书签，自动加载浏览器书签作为预览
    if (!bookmarks.value.length && !folders.value.length) {
      await loadBrowserBookmarks();
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t('ui.home.load_failed');
  } finally {
    isLoading.value = false;
  }
}

async function loadBrowserBookmarks() {
  try {
    if (typeof chrome !== 'undefined' && chrome.bookmarks) {
      const tree = await chrome.bookmarks.getTree();
      browserBookmarks.value = extractBookmarksFromTree(tree);
      showBrowserBookmarks.value = true;
    }
  } catch {
    // Ignore browser bookmark errors
  }
}

function extractBookmarksFromTree(nodes: BrowserBookmark[]): BrowserBookmark[] {
  const result: BrowserBookmark[] = [];
  for (const node of nodes) {
    if (node.url) {
      result.push({ id: node.id, title: node.title || node.url, url: node.url, parentId: node.parentId });
    }
    if (node.children) {
      result.push(...extractBookmarksFromTree(node.children));
    }
  }
  return result;
}

function goToSync() {
  router.push({ name: 'sync' });
}

function goToSettings() {
  router.push({ name: 'settings' });
}

onMounted(() => {
  void loadBookmarks();
});
</script>

<template>
  <PopupLayout>
    <header class="relative z-20 shrink-0 border-b border-slate-200 bg-white/95 px-4 pb-3 pt-4 backdrop-blur">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-lg font-semibold tracking-[0.2em] text-sky-700">FavsHub</div>
        </div>
        <div class="flex items-center gap-0.5">
          <n-button
            quaternary
            circle
            type="default"
            :title="t('ui.home.refresh')"
            :loading="isLoading"
            @click="loadBookmarks"
          >
            <template #icon>
              <n-icon :component="RefreshOutline" size="18" />
            </template>
          </n-button>
        </div>
      </div>
      <div class="mt-3">
        <Search v-model="searchQuery" />
      </div>
    </header>

    <main class="relative z-0 min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <section>
        <div class="mb-3 flex items-center justify-between px-1">
          <div>
            <h1 class="text-base font-semibold text-slate-900">{{ t('ui.home.bookmark_categories') }}</h1>
          </div>
        </div>

        <div v-if="isLoading" class="flex min-h-56 items-center justify-center">
          <n-spin size="small">
            <template #description>
              <span class="text-xs text-slate-500">{{ t('ui.home.loading') }}</span>
            </template>
          </n-spin>
        </div>

        <div v-else-if="errorMessage" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <div class="text-sm font-medium text-slate-700">{{ t('ui.home.error_title') }}</div>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ errorMessage }}</p>
          <n-button class="mt-4" secondary type="primary" @click="loadBookmarks">
            <template #icon>
              <n-icon :component="RefreshOutline" />
            </template>
            {{ t('ui.home.reload') }}
          </n-button>
        </div>

        <div v-else-if="!isLoggedIn" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <div class="text-sm font-medium text-slate-700">{{ t('ui.home.login_required_title') }}</div>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ t('ui.home.login_required_desc') }}</p>
          <n-button class="mt-4" type="primary" @click="goToSettings">
            <template #icon>
              <n-icon :component="LogInOutline" />
            </template>
            {{ t('ui.home.go_login') }}
          </n-button>
        </div>

        <div v-else-if="!folders.length && !bookmarks.length && !showBrowserBookmarks" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <div class="text-sm font-medium text-slate-700">{{ t('ui.home.empty_title') }}</div>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ t('ui.home.empty_desc') }}</p>
          <n-button class="mt-4" type="primary" @click="goToSync">
            <template #icon>
              <n-icon :component="CloudUploadOutline" />
            </template>
            {{ t('ui.home.sync_bookmarks') }}
          </n-button>
        </div>

        <div v-else-if="isSearching" class="space-y-1">
          <div class="mb-1 px-1 text-xs text-slate-500">
            {{ searchResults.length ? t('ui.home.search_results_found', { n: searchResults.length }) : t('ui.home.search_results_empty', { name: searchQuery.trim() }) }}
          </div>
          <div
            v-for="bookmark in searchResults"
            :key="bookmark.id"
            class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-sky-50/70"
            @click="openLink(bookmark.url)"
          >
            <img :src="getFaviconUrl(bookmark.url)" :alt="bookmark.title" class="h-4 w-4 shrink-0 rounded-sm" loading="lazy" @error="handleFaviconError($event)" />
            <div class="hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-sky-100 text-[10px] font-bold text-sky-600">{{ getBookmarkInitial(bookmark.title) }}</div>
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-sky-600">{{ bookmark.title }}</span>
          </div>
        </div>

        <div v-else class="space-y-1">
          <template v-for="folder in folderTree" :key="folder.id">
            <!-- 文件夹（递归渲染） -->
            <FolderItem
              :folder="folder"
              :bookmarks="bookmarks"
              :expanded-ids="expandedFolderIds"
              :depth="0"
              @toggle="toggleFolder"
              @open="openLink"
            />
          </template>

          <!-- 根目录书签 -->
          <div v-if="getRootBookmarks().length" class="mt-2 space-y-1">
            <div
              v-for="bookmark in getRootBookmarks()"
              :key="bookmark.id"
              class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-sky-50/70"
              @click="openLink(bookmark.url)"
            >
              <img :src="getFaviconUrl(bookmark.url)" :alt="bookmark.title" class="h-4 w-4 shrink-0 rounded-sm" loading="lazy" @error="handleFaviconError($event)" />
              <div class="hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-sky-100 text-[10px] font-bold text-sky-600">{{ getBookmarkInitial(bookmark.title) }}</div>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-sky-600">{{ bookmark.title }}</span>
            </div>
          </div>
        </div>

        <!-- 浏览器书签预览（服务器无书签时显示） -->
        <div v-if="showBrowserBookmarks && browserBookmarks.length" class="mt-4">
          <div class="mb-3 flex items-center justify-between px-1">
            <div>
              <h1 class="text-base font-semibold text-slate-900">{{ t('ui.home.browser_preview_title') }}</h1>
              <p class="text-xs text-slate-500">{{ t('ui.home.browser_preview_desc') }}</p>
            </div>
            <n-button size="small" type="primary" @click="goToSync">
              <template #icon>
                <n-icon :component="CloudUploadOutline" />
              </template>
              {{ t('ui.home.sync_to_cloud') }}
            </n-button>
          </div>
          <div class="space-y-1">
            <div
              v-for="bookmark in browserBookmarks.slice(0, 50)"
              :key="bookmark.id"
              class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-sky-50/70"
              @click="bookmark.url && openLink(bookmark.url)"
            >
              <img v-if="bookmark.url" :src="getFaviconUrl(bookmark.url)" :alt="bookmark.title" class="h-4 w-4 shrink-0 rounded-sm" loading="lazy" @error="handleFaviconError($event)" />
              <div v-else class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-amber-100">
                <n-icon :component="FolderOpenOutline" size="10" class="text-amber-500" />
              </div>
              <div class="hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-sky-100 text-[10px] font-bold text-sky-600">{{ getBookmarkInitial(bookmark.title) }}</div>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-sky-600">{{ bookmark.title }}</span>
            </div>
          </div>
          <div v-if="browserBookmarks.length > 50" class="mt-2 text-center text-xs text-slate-400">
            {{ t('ui.home.browser_preview_more', { n: browserBookmarks.length }) }}
          </div>
        </div>
      </section>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
