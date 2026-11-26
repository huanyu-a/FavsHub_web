import { flushPromises, mount } from '@vue/test-utils';
import { onMounted, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sync from '@/components/Sync.vue';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  getToken: vi.fn(),
  getBaseUrl: vi.fn(),
  getTree: vi.fn(),
  dialogInfo: vi.fn(),
  dialogWarning: vi.fn(),
  message: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
  sessionGet: vi.fn(),
  sessionSet: vi.fn(),
  loadHistory: vi.fn(),
  recordHistory: vi.fn(),
  state: {
    token: 'token',
    baseUrl: 'https://hub.example',
  },
}));

vi.mock('@/utils/request', () => ({ request: mocks.request }));
vi.mock('@/utils/storage', () => ({
  tokenStorage: { getValue: mocks.getToken },
  baseUrlStorage: { getValue: mocks.getBaseUrl },
}));
vi.mock('@/utils/storage-session', () => ({
  faviconWarmingStateStorage: { getValue: mocks.sessionGet, setValue: mocks.sessionSet },
}));
vi.mock('@/utils/sync-history', () => ({
  loadSyncActivity: mocks.loadHistory,
  recordSyncSuccess: mocks.recordHistory,
}));
vi.mock('@/utils/sync-mutex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/sync-mutex')>();
  return {
    ...actual,
    withSyncOperationLock: vi.fn(async (_operation, task) => task()),
  };
});
vi.mock('@/i18n', () => ({ t: (key: string) => key }));
vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('naive-ui')>();
  return {
    ...actual,
    useDialog: () => ({ info: mocks.dialogInfo, warning: mocks.dialogWarning }),
    useMessage: () => mocks.message,
  };
});

type Node = chrome.bookmarks.BookmarkTreeNode;
let tree: Node[];

function resetTree() {
  tree = [{
    id: '0', title: '', syncing: false,
    children: [{
      id: '1', title: '书签栏', syncing: false,
      children: [
        { id: 'bookmark', title: '原始标题', url: 'https://a.example/', syncing: false },
        { id: 'empty', title: '空夹原标题', syncing: false, children: [] },
      ],
    }],
  }];
}

describe('上传确认执行编排', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('useMessage', () => mocks.message);
    vi.stubGlobal('useDialog', () => ({ info: mocks.dialogInfo, warning: mocks.dialogWarning }));
    vi.stubGlobal('ref', ref);
    vi.stubGlobal('onMounted', onMounted);
    resetTree();
    mocks.state.token = 'token';
    mocks.state.baseUrl = 'https://hub.example';
    mocks.getToken.mockImplementation(async () => mocks.state.token);
    mocks.getBaseUrl.mockImplementation(async () => mocks.state.baseUrl);
    mocks.getTree.mockImplementation(async () => structuredClone(tree));
    vi.stubGlobal('chrome', { bookmarks: { getTree: mocks.getTree } });
    mocks.sessionGet.mockResolvedValue({ running: false, paused: false, total: 0, current: 0, progressMsg: '', beat: 0 });
    mocks.sessionSet.mockResolvedValue(undefined);
    mocks.loadHistory.mockResolvedValue({ history: [], lastSyncAt: 0 });
    mocks.recordHistory.mockResolvedValue({ history: [], lastSyncAt: 0 });
    mocks.request.mockImplementation(async (path: string) => {
      if (path === '/api/sync/upload-preview') {
        return { added: 1, updated: 0, deleted: 0, foldersCreated: 0, foldersDeleted: 0, revision: 'r1' };
      }
      if (path === '/api/sync/bookmarks') {
        return { success: true, added: 1, updated: 0, deleted: 0, foldersCreated: 0, foldersDeleted: 0, total: 1, revision: 'r2' };
      }
      if (path === '/api/sync/favicons') return { count: 1 };
      throw new Error(`unexpected request: ${path}`);
    });
  });

  it.each([
    { name: 'token', mutate: () => { mocks.state.token = 'other-token'; } },
    { name: 'baseUrl', mutate: () => { mocks.state.baseUrl = 'https://other.example'; } },
    { name: 'tree 标题', mutate: () => { tree[0].children![0].children![1].title = '空夹已改名'; } },
    { name: 'payload', mutate: () => { tree[0].children![0].children![0].title = '书签 payload 已改名'; } },
  ])('确认后 $name 变化时 PUT 与 favicon 均零调用', async ({ mutate }) => {
    const wrapper = mount(Sync, {
      global: {
        stubs: {
          PopupLayout: { template: '<div><slot /></div>' },
          PageTitle: true,
          BottomNav: true,
          NIcon: true,
          NButton: true,
          NSwitch: true,
          NProgress: true,
        },
      },
    });
    await flushPromises();
    const vm = wrapper.vm as unknown as { handleSync: () => Promise<void> };
    const pending = vm.handleSync();
    await vi.waitFor(() => expect(mocks.dialogInfo).toHaveBeenCalledTimes(1));

    mutate();
    const previewDialog = mocks.dialogInfo.mock.calls[0][0];
    previewDialog.onPositiveClick();
    await pending;
    await flushPromises();

    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0]).toBe('/api/sync/upload-preview');
    expect(mocks.request).not.toHaveBeenCalledWith('/api/sync/bookmarks', expect.anything());
    expect(mocks.request).not.toHaveBeenCalledWith('/api/sync/favicons', expect.anything());
    wrapper.unmount();
  });
});
