import { describe, expect, it } from 'vitest';
import {
  buildDownloadPreview,
  createUploadPlanSignature,
  formatChangeSummary,
  normalizeChangeSummary,
  normalizeUploadBookmarks,
  type SyncServerBookmark,
  type SyncServerFolder,
} from '@/utils/sync-preview';
import type { FlatBookmark } from '@/utils/flatten-bookmarks';
import type { SyncSnapshot } from '@/utils/storage';

function local(url: string, title = url, folderPath?: string, container = 'bar'): FlatBookmark {
  return {
    title,
    url,
    folder_path: folderPath,
    container,
    sort_order: 0,
  };
}

function server(
  url: string,
  title = url,
  folderId: number | null = null,
  container = 'bar',
): SyncServerBookmark {
  return { title, url, folder_id: folderId, container, label: 'sync' };
}

function folder(id: number, name: string, parentId: number | null = null): SyncServerFolder {
  return { id, name, parent_id: parentId };
}

let nextNodeId = 0;
function node(
  title: string,
  children?: chrome.bookmarks.BookmarkTreeNode[],
  url?: string,
): chrome.bookmarks.BookmarkTreeNode {
  return { id: `node-${++nextNodeId}`, title, children, url } as chrome.bookmarks.BookmarkTreeNode;
}

function tree(
  barChildren: chrome.bookmarks.BookmarkTreeNode[],
  otherChildren: chrome.bookmarks.BookmarkTreeNode[] = [],
): chrome.bookmarks.BookmarkTreeNode[] {
  return [node('', [
    node('书签栏', barChildren),
    node('其他书签', otherChildren),
  ])];
}

describe('上传计划绑定', () => {
  it('规范化 payload 但不修改原数组，签名绑定完整树和实际 PUT 数据', () => {
    const bookmarks = [local(' https://a.com/// ', '标题', 'Work')];
    const before = structuredClone(bookmarks);
    const normalized = normalizeUploadBookmarks(bookmarks);
    const input = { tree: tree([node('Work', [node('标题', undefined, 'https://a.com')])]), bookmarks: normalized };
    const signature = createUploadPlanSignature(input);

    expect(bookmarks).toEqual(before);
    expect(normalized[0].url).toBe('https://a.com');
    expect(createUploadPlanSignature(structuredClone(input))).toBe(signature);

    const changedTree = structuredClone(input);
    changedTree.tree[0].children![0].children![0].title = '树已变化';
    expect(createUploadPlanSignature(changedTree)).not.toBe(signature);

    const changedPayload = structuredClone(input);
    changedPayload.bookmarks[0].title = 'payload 已变化';
    expect(createUploadPlanSignature(changedPayload)).not.toBe(signature);
  });
});

describe('下载预览', () => {
  it('首次同步复用纯 diff：新增与标题更新，不产生删除', () => {
    const browserBookmark = node('旧标题', undefined, 'https://same.com');
    const preview = buildDownloadPreview({
      folders: [folder(1, 'Work')],
      bookmarks: [
        server('https://same.com', '新标题'),
        server('https://new.com', '新增', 1),
      ],
      snapshot: null,
      tree: tree([browserBookmark]),
    });

    expect(preview.isFirstSync).toBe(true);
    expect(preview.summary).toMatchObject({
      added: 1,
      updated: 1,
      moved: 0,
      deleted: 0,
      foldersAdded: 1,
      foldersDeleted: 0,
    });
  });

  it('后续同步将同 URL 的新旧路径配对为移动而非新增加删除', () => {
    const oldFolder = node('Old', [node('页面', undefined, 'https://a.com')]);
    const snapshot: SyncSnapshot = {
      timestamp: 1,
      bookmarks: [{ key: 'bar/Old/https://a.com', title: '页面' }],
      folders: [{ key: 'bar/Old' }],
    };
    const preview = buildDownloadPreview({
      folders: [folder(1, 'New')],
      bookmarks: [server('https://a.com', '页面', 1)],
      snapshot,
      tree: tree([oldFolder]),
    });

    expect(preview.isFirstSync).toBe(false);
    expect(preview.summary).toEqual({
      added: 0,
      updated: 0,
      moved: 1,
      deleted: 0,
      foldersAdded: 1,
      foldersDeleted: 0,
    });
    expect(preview.foldersSkipped).toBe(1);
  });

  it('后续同步保留真实删除，本地新增不会被误删', () => {
    const snapshot: SyncSnapshot = {
      timestamp: 1,
      bookmarks: [{ key: 'bar//https://gone.com', title: '已删除' }],
      folders: [],
    };
    const preview = buildDownloadPreview({
      folders: [],
      bookmarks: [],
      snapshot,
      tree: tree([
        node('已删除', undefined, 'https://gone.com'),
        node('本地新增', undefined, 'https://local.com'),
      ]),
    });

    expect(preview.summary.deleted).toBe(1);
    expect(preview.summary.added).toBe(0);
    expect(preview.summary.moved).toBe(0);
  });

  it('预览只删除当前空夹，非空夹从执行 diff 剔除且签名基于处理后计划', () => {
    const nonEmpty = node('NonEmpty', [node('本地书签', undefined, 'https://local.example')]);
    const empty = node('Empty', []);
    const snapshot: SyncSnapshot = {
      timestamp: 1,
      bookmarks: [],
      folders: [{ key: 'bar/NonEmpty' }, { key: 'bar/Empty' }],
    };
    const preview = buildDownloadPreview({ folders: [], bookmarks: [], snapshot, tree: tree([nonEmpty, empty]) });

    expect(preview.foldersSkipped).toBe(1);
    expect(preview.summary.foldersDeleted).toBe(1);
    expect(preview.diff.toRemoveFolders).toEqual([{ browserId: empty.id, key: 'bar/Empty' }]);
    expect(JSON.parse(preview.planSignature).diff.toRemoveFolders).toEqual(preview.diff.toRemoveFolders);
  });

  it('计划签名绑定完整 diff、浏览器树和本地快照，而不只是计数', () => {
    const input = {
      revision: 'r1',
      folders: [folder(1, 'Work')],
      bookmarks: [server('https://a.com', '标题', 1)],
      snapshot: {
        timestamp: 1,
        bookmarks: [{ key: 'bar/Work/https://a.com', title: '标题' }],
        folders: [{ key: 'bar/Work' }],
      } satisfies SyncSnapshot,
      tree: tree([node('Work', [node('标题', undefined, 'https://a.com')])]),
    };
    const baseline = buildDownloadPreview(input);
    expect(buildDownloadPreview(structuredClone(input)).planSignature).toBe(baseline.planSignature);

    const changedDiff = structuredClone(input);
    changedDiff.bookmarks[0].title = '新标题';
    expect(buildDownloadPreview(changedDiff).planSignature).not.toBe(baseline.planSignature);

    const changedTree = structuredClone(input);
    changedTree.tree[0].children![0].children!.push(node('本地新增', undefined, 'https://local.example'));
    expect(buildDownloadPreview(changedTree).planSignature).not.toBe(baseline.planSignature);

    const changedSnapshot = structuredClone(input);
    changedSnapshot.snapshot.timestamp = 2;
    expect(buildDownloadPreview(changedSnapshot).planSignature).not.toBe(baseline.planSignature);
  });
});

describe('摘要格式化与归一化', () => {
  const labels: Record<string, string> = {
    added: '新增', updated: '更新', moved: '移动', deleted: '删除',
    folders_added: '新建文件夹', folders_deleted: '删除文件夹',
  };
  const translate = (key: string, count: number) => key === 'none' ? '无书签或文件夹变更' : `${labels[key]} ${count}`;

  it('输出所有非零类别，零变更显示明确空态', () => {
    expect(formatChangeSummary({
      added: 1,
      updated: 2,
      moved: 3,
      deleted: 4,
      foldersAdded: 5,
      foldersDeleted: 6,
    }, translate)).toBe('新增 1 · 更新 2 · 移动 3 · 删除 4 · 新建文件夹 5 · 删除文件夹 6');
    expect(formatChangeSummary(normalizeChangeSummary({}), translate)).toBe('无书签或文件夹变更');
  });

  it('负数、非整数和非数值不会进入摘要', () => {
    expect(normalizeChangeSummary({
      added: -1,
      updated: 2.9,
      moved: Number.NaN,
      deleted: '3',
      foldersAdded: 1,
    })).toEqual({
      added: 0,
      updated: 2,
      moved: 0,
      deleted: 0,
      foldersAdded: 1,
      foldersDeleted: 0,
    });
  });
});
