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
import { useRouter } from 'vue-router';

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

function getFaviconUrl(url: string) {
  try {
    // 优先用 Chrome 扩展 favicon API（本地缓存，速度快）
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    faviconUrl.searchParams.set('pageUrl', url);
    faviconUrl.searchParams.set('size', '32');
    faviconUrl.searchParams.set('cache', '1');
    return faviconUrl.toString();
  } catch {
    // 回退到 Google favicon 服务
    try {
      const hostname = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    } catch {
      return '';
    }
  }
}

function getFallbackFaviconUrl(url: string) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return '';
  }
}

function getBookmarkInitial(title: string) {
  return title.charAt(0).toUpperCase();
}

function onFaviconError(e: Event, title: string) {
  const img = e.target as HTMLImageElement;
  // 尝试用 Google favicon 作为 fallback
  const currentSrc = img.src;
  if (currentSrc.includes('chrome-extension://') || currentSrc.includes('/_favicon/')) {
    // 从 URL 中提取 pageUrl 参数
    try {
      const u = new URL(currentSrc);
      const pageUrl = u.searchParams.get('pageUrl');
      if (pageUrl) {
        const hostname = new URL(pageUrl).hostname;
        img.src = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
        return;
      }
    } catch {}
  }
  // 最终回退：显示首字母
  img.style.display = 'none';
  const fallback = img.nextElementSibling as HTMLElement;
  if (fallback) fallback.style.display = 'flex';
}

function openLink(url: string) {
  chrome.tabs.create({ url });
}

function getFolderBookmarks(folderId: number) {
  return bookmarks.value.filter(b => b.folder_id === folderId);
}

function getRootBookmarks() {
  return bookmarks.value.filter(b => !b.folder_id);
}

function isFolderExpanded(id: number) {
  return expandedFolderIds.value.has(id);
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
    errorMessage.value = error instanceof Error ? error.message : '加载失败';
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
            title="刷新"
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
            <h1 class="text-base font-semibold text-slate-900">书签分类</h1>
          </div>
        </div>

        <div v-if="isLoading" class="flex min-h-56 items-center justify-center">
          <n-spin size="small">
            <template #description>
              <span class="text-xs text-slate-500">正在加载书签...</span>
            </template>
          </n-spin>
        </div>

        <div v-else-if="errorMessage" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <div class="text-sm font-medium text-slate-700">书签暂时无法展示</div>
          <p class="mt-1 text-xs leading-5 text-slate-500">{{ errorMessage }}</p>
          <n-button class="mt-4" secondary type="primary" @click="loadBookmarks">
            <template #icon>
              <n-icon :component="RefreshOutline" />
            </template>
            重新加载
          </n-button>
        </div>

        <div v-else-if="!isLoggedIn" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <div class="text-sm font-medium text-slate-700">请先登录</div>
          <p class="mt-1 text-xs leading-5 text-slate-500">登录 FavsHub 账号后即可查看云端书签</p>
          <n-button class="mt-4" type="primary" @click="goToSettings">
            <template #icon>
              <n-icon :component="LogInOutline" />
            </template>
            前往登录
          </n-button>
        </div>

        <div v-else-if="!folders.length && !bookmarks.length && !showBrowserBookmarks" class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <div class="text-sm font-medium text-slate-700">还没有书签</div>
          <p class="mt-1 text-xs leading-5 text-slate-500">同步浏览器书签到云端后，将显示在这里。</p>
          <n-button class="mt-4" type="primary" @click="goToSync">
            <template #icon>
              <n-icon :component="CloudUploadOutline" />
            </template>
            同步书签
          </n-button>
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
              <img :src="getFaviconUrl(bookmark.url)" :alt="bookmark.title" class="h-4 w-4 shrink-0 rounded-sm" loading="lazy" @error="onFaviconError($event, bookmark.title)" />
              <div class="hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-sky-100 text-[10px] font-bold text-sky-600">{{ getBookmarkInitial(bookmark.title) }}</div>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-sky-600">{{ bookmark.title }}</span>
            </div>
          </div>
        </div>

        <!-- 浏览器书签预览（服务器无书签时显示） -->
        <div v-if="showBrowserBookmarks && browserBookmarks.length" class="mt-4">
          <div class="mb-3 flex items-center justify-between px-1">
            <div>
              <h1 class="text-base font-semibold text-slate-900">浏览器书签预览</h1>
              <p class="text-xs text-slate-500">以下为本地浏览器书签，同步后可在多设备查看</p>
            </div>
            <n-button size="small" type="primary" @click="goToSync">
              <template #icon>
                <n-icon :component="CloudUploadOutline" />
              </template>
              同步到云端
            </n-button>
          </div>
          <div class="space-y-1">
            <div
              v-for="bookmark in browserBookmarks.slice(0, 50)"
              :key="bookmark.id"
              class="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-sky-50/70"
              @click="bookmark.url && openLink(bookmark.url)"
            >
              <img v-if="bookmark.url" :src="getFaviconUrl(bookmark.url)" :alt="bookmark.title" class="h-4 w-4 shrink-0 rounded-sm" loading="lazy" @error="onFaviconError($event, bookmark.title)" />
              <div v-else class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-amber-100">
                <n-icon :component="FolderOpenOutline" size="10" class="text-amber-500" />
              </div>
              <div class="hidden h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-sky-100 text-[10px] font-bold text-sky-600">{{ getBookmarkInitial(bookmark.title) }}</div>
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-sky-600">{{ bookmark.title }}</span>
            </div>
          </div>
          <div v-if="browserBookmarks.length > 50" class="mt-2 text-center text-xs text-slate-400">
            显示前 50 条，共 {{ browserBookmarks.length }} 条书签
          </div>
        </div>
      </section>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
