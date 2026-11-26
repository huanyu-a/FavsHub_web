import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from '#imports';
import { buildDownloadPreview, type SyncServerSnapshot } from '@/utils/sync-preview';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  loadSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  getToken: vi.fn(),
  getBaseUrl: vi.fn(),
}));

vi.mock('@/utils/request', () => ({ request: mocks.request }));
vi.mock('@/utils/sync-snapshot', () => ({
  loadSnapshot: mocks.loadSnapshot,
  saveSnapshot: mocks.saveSnapshot,
}));
vi.mock('@/utils/storage', () => ({
  tokenStorage: { getValue: mocks.getToken },
  baseUrlStorage: { getValue: mocks.getBaseUrl },
}));

import {
  syncFavsHubToBrowser,
  SyncWriteError,
} from '@/utils/browser-sync';

type Node = chrome.bookmarks.BookmarkTreeNode;

function emptyTree(): Node[] {
  return [{
    id: '0', title: '', syncing: false,
    children: [{ id: '1', title: '书签栏', syncing: false, children: [] }],
  }];
}

function findNode(nodes: Node[], id: string): Node | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children || [], id);
    if (found) return found;
  }
  return undefined;
}

function findParent(nodes: Node[], id: string): Node | undefined {
  for (const node of nodes) {
    if ((node.children || []).some(child => child.id === id)) return node;
    const found = findParent(node.children || [], id);
    if (found) return found;
  }
  return undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

let tree: Node[];
let nextId = 100;
let createMock: ReturnType<typeof vi.fn>;

function installBrowserApi() {
  const getTree = vi.fn(async () => clone(tree));
  const create = vi.fn(async (input: { parentId: string; title: string; url?: string }) => {
    if (input.url?.includes('fail')) throw new Error('create rejected');
    const parent = findNode(tree, input.parentId);
    if (!parent) throw new Error('missing parent');
    const created: Node = {
      id: String(nextId++), title: input.title, url: input.url, syncing: false,
      children: input.url ? undefined : [],
    };
    parent.children ||= [];
    parent.children.push(created);
    return clone(created);
  });
  createMock = create;
  Object.assign(browser.bookmarks, {
    getTree,
    create,
    get: vi.fn(async (id: string) => {
      const node = findNode(tree, id);
      if (!node) throw new Error('missing bookmark');
      return clone(node);
    }),
    update: vi.fn(async (id: string, input: { title?: string }) => {
      const node = findNode(tree, id);
      if (!node) throw new Error('missing bookmark');
      Object.assign(node, input);
      return clone(node);
    }),
    remove: vi.fn(async (id: string) => {
      const parent = findParent(tree, id);
      if (!parent) throw new Error('missing bookmark');
      parent.children = parent.children!.filter(child => child.id !== id);
    }),
    getChildren: vi.fn(async (id: string) => {
      const node = findNode(tree, id);
      if (!node) throw new Error('missing folder');
      return clone(node.children || []);
    }),
    removeTree: vi.fn(async (id: string) => {
      const parent = findParent(tree, id);
      if (!parent) throw new Error('missing folder');
      parent.children = parent.children!.filter(child => child.id !== id);
    }),
  });
}

function serverBookmark(title = '新增', url = 'https://new.example') {
  return { id: 1, title, url, folder_id: null, container: 'bar', label: 'sync' };
}

function makePreview(server: SyncServerSnapshot) {
  return buildDownloadPreview({
    revision: server.revision,
    folders: server.folders,
    bookmarks: server.bookmarks,
    snapshot: null,
    tree: clone(tree),
  });
}

describe('下载执行安全边界', () => {
  let server: SyncServerSnapshot;

  beforeEach(() => {
    vi.clearAllMocks();
    tree = emptyTree();
    nextId = 100;
    installBrowserApi();
    server = {
      revision: 'r1',
      folders: [],
      bookmarks: [serverBookmark()],
      pool_protected_folder_ids: [],
    };
    mocks.getToken.mockResolvedValue('token');
    mocks.getBaseUrl.mockResolvedValue('https://hub.example');
    mocks.request.mockImplementation(async () => server);
    mocks.loadSnapshot.mockResolvedValue(null);
    mocks.saveSnapshot.mockResolvedValue(undefined);
  });

  it('预览未变化时执行并保存真实新快照', async () => {
    const preview = makePreview(server);
    const stats = await syncFavsHubToBrowser({ preview });
    expect(stats).toMatchObject({ added: 1, failed: 0, snapshotSaved: true });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(mocks.saveSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.saveSnapshot.mock.calls[0][0].bookmarks[0].key).toContain('https://new.example');
  });

  it.each([
    { name: 'token', baseUrl: 'https://hub.example', token: 'other-token' },
    { name: 'baseUrl', baseUrl: 'https://other.example', token: 'token' },
  ])('预览后 $name 变化时零写中止，重取仍固定原上下文', async (latest) => {
    const preview = makePreview(server);
    const context = { baseUrl: 'https://hub.example', token: 'token' };
    mocks.getBaseUrl.mockResolvedValue(latest.baseUrl);
    mocks.getToken.mockResolvedValue(latest.token);

    await expect(syncFavsHubToBrowser({ preview, context })).rejects.toMatchObject({
      stage: 'compute-diff', code: 'SYNC_PREVIEW_STALE',
    });
    expect(mocks.request).toHaveBeenCalledWith('/api/sync/snapshot', {
      baseUrl: context.baseUrl, token: context.token,
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('执行只删除预览中的空夹，非空夹不会触发部分写入失败', async () => {
    server = { ...server, folders: [], bookmarks: [] };
    const nonEmpty: Node = {
      id: 'nonempty', title: 'NonEmpty', syncing: false,
      children: [{ id: 'local', title: '本地', url: 'https://local.example', syncing: false }],
    };
    const empty: Node = { id: 'empty', title: 'Empty', syncing: false, children: [] };
    tree[0].children![0].children = [nonEmpty, empty];
    const snapshot = {
      timestamp: 1,
      bookmarks: [],
      folders: [{ key: 'bar/NonEmpty' }, { key: 'bar/Empty' }],
    };
    mocks.loadSnapshot.mockResolvedValue(snapshot);
    const preview = buildDownloadPreview({
      revision: server.revision, folders: [], bookmarks: [], snapshot, tree: clone(tree),
    });

    const stats = await syncFavsHubToBrowser({ preview });
    expect(stats).toMatchObject({ foldersRemoved: 1, failed: 0, snapshotSaved: true });
    expect(browser.bookmarks.removeTree).toHaveBeenCalledTimes(1);
    expect(browser.bookmarks.removeTree).toHaveBeenCalledWith('empty');
    expect(findNode(tree, 'nonempty')).toBeDefined();
  });

  it('revision 变化时在任何浏览器写入前中止', async () => {
    const preview = makePreview(server);
    server = { ...server, revision: 'r2' };
    await expect(syncFavsHubToBrowser({ preview })).rejects.toMatchObject({
      stage: 'compute-diff', code: 'SYNC_PREVIEW_STALE',
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('计数相同但完整 diff 标题变化时零写中止', async () => {
    const preview = makePreview(server);
    server = { ...server, bookmarks: [serverBookmark('另一个标题')] };
    await expect(syncFavsHubToBrowser({ preview })).rejects.toMatchObject({ code: 'SYNC_PREVIEW_STALE' });
    expect(createMock).not.toHaveBeenCalled();
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('浏览器树新增本地书签时零写中止', async () => {
    const preview = makePreview(server);
    tree[0].children![0].children!.push({ id: '90', title: '本地', url: 'https://local.example', syncing: false });
    await expect(syncFavsHubToBrowser({ preview })).rejects.toMatchObject({ code: 'SYNC_PREVIEW_STALE' });
    expect(createMock).not.toHaveBeenCalled();
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('本地快照变化时零写中止', async () => {
    const preview = makePreview(server);
    mocks.loadSnapshot.mockResolvedValue({ bookmarks: [], folders: [], timestamp: 2 });
    await expect(syncFavsHubToBrowser({ preview })).rejects.toMatchObject({ code: 'SYNC_PREVIEW_STALE' });
    expect(createMock).not.toHaveBeenCalled();
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('创建失败返回真实失败计数且不保存快照', async () => {
    server = { ...server, bookmarks: [serverBookmark('失败', 'https://fail.example')] };
    const preview = makePreview(server);
    const error = await syncFavsHubToBrowser({ preview }).catch(value => value);
    expect(error).toBeInstanceOf(SyncWriteError);
    expect(error.stats).toMatchObject({ added: 0, failed: 1, snapshotSaved: false });
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('部分成功部分失败不会伪报成功或保存快照', async () => {
    server = {
      ...server,
      bookmarks: [serverBookmark(), { ...serverBookmark('失败', 'https://fail.example'), id: 2 }],
    };
    const preview = makePreview(server);
    const error = await syncFavsHubToBrowser({ preview }).catch(value => value);
    expect(error).toBeInstanceOf(SyncWriteError);
    expect(error.stats).toMatchObject({ added: 1, failed: 1, snapshotSaved: false });
    expect(error.stats.succeeded).toBe(1);
    expect(mocks.saveSnapshot).not.toHaveBeenCalled();
  });

  it('快照保存异常作为 write-snapshot 阶段暴露', async () => {
    mocks.saveSnapshot.mockRejectedValue(new Error('storage unavailable'));
    const preview = makePreview(server);
    await expect(syncFavsHubToBrowser({ preview })).rejects.toMatchObject({
      stage: 'write-snapshot', code: 'storage unavailable',
    });
  });

  it('凭据读取异常作为 read-token 阶段暴露且不请求服务端', async () => {
    mocks.getToken.mockRejectedValue(new Error('token unavailable'));
    await expect(syncFavsHubToBrowser()).rejects.toMatchObject({
      stage: 'read-token', code: 'token unavailable',
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});
