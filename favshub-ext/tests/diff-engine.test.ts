import { describe, it, expect } from 'vitest';
import {
  encodeKeySegment,
  decodeKeySegment,
  computeDiff,
  type DiffBookmarkEntry,
  type DiffBrowserEntry,
  type DiffSnapshotEntry,
} from '@/utils/diff-engine';

describe('key 段转义', () => {
  it('斜杠与百分号被转义，普通名称保持不变', () => {
    expect(encodeKeySegment('a/b')).toBe('a%2Fb');
    expect(encodeKeySegment('100%')).toBe('100%25');
    expect(encodeKeySegment('a/b%c')).toBe('a%2Fb%25c');
    expect(encodeKeySegment('普通文件夹')).toBe('普通文件夹');
  });

  it('编码后解码往返无损（含字面 %2F 名称）', () => {
    const names = ['a/b', '100%', 'a/b%c', '%2F', 'a%2Fb', '中文/名称', 'plain'];
    for (const name of names) {
      expect(decodeKeySegment(encodeKeySegment(name))).toBe(name);
    }
  });

  it('解码顺序正确：先 %2F 再 %25，字面 %2F 不会被二次解码', () => {
    // 字面名称 "a%2Fb" 编码为 "a%252Fb"，解码必须还原字面值而非斜杠
    expect(decodeKeySegment('a%252Fb')).toBe('a%2Fb');
    expect(decodeKeySegment('a%2Fb')).toBe('a/b');
  });
});

function bm(key: string, title: string, url: string, folderPath: string, container: string): [string, DiffBookmarkEntry] {
  return [key, { key, title, url, folderPath, container }];
}

function br(key: string, title: string, id: string): [string, DiffBrowserEntry] {
  return [key, { key, title, browserId: id }];
}

function snap(key: string, title: string): [string, DiffSnapshotEntry] {
  return [key, { key, title }];
}

const SERVER_BAR = 'bar/a.com/page';
const SERVER_FOLDER = 'bar/work';

describe('computeDiff 首次同步（无快照）', () => {
  it('仅添加服务端有而浏览器没有的，不产生删除', () => {
    const server = new Map([bm(SERVER_BAR, 'Page', 'https://a.com/page', 'a.com', 'bar')]);
    const browser = new Map<string, DiffBrowserEntry>();
    const diff = computeDiff(server, browser, null, new Set([SERVER_FOLDER]), new Map(), null);

    expect(diff.isFirstSync).toBe(true);
    expect(diff.toAddBookmarks).toHaveLength(1);
    expect(diff.toAddBookmarks[0].serverEntry.url).toBe('https://a.com/page');
    expect(diff.toRemoveBookmarks).toHaveLength(0);
    expect(diff.toAddFolders.map((f) => f.key)).toContain(SERVER_FOLDER);
  });

  it('已存在但标题不同 → 标题更新', () => {
    const server = new Map([bm(SERVER_BAR, '新标题', 'https://a.com/page', 'a.com', 'bar')]);
    const browser = new Map([br(SERVER_BAR, '旧标题', 'b1')]);
    const diff = computeDiff(server, browser, null, new Set(), new Map(), null);

    expect(diff.toUpdateTitles).toHaveLength(1);
    expect(diff.toUpdateTitles[0]).toMatchObject({ browserId: 'b1', newTitle: '新标题' });
    expect(diff.toAddBookmarks).toHaveLength(0);
  });

  it('顶层文件夹 parentKey 为 null，嵌套文件夹给出父 key 并解码名称', () => {
    const folders = new Set(['bar/work', 'bar/work/deep']);
    const diff = computeDiff(new Map(), new Map(), null, folders, new Map(), null);

    const work = diff.toAddFolders.find((f) => f.key === 'bar/work');
    const deep = diff.toAddFolders.find((f) => f.key === 'bar/work/deep');
    expect(work?.parentKey).toBeNull();
    expect(work?.name).toBe('work');
    expect(deep?.parentKey).toBe('bar/work');
    expect(deep?.name).toBe('deep');
  });

  it('名称含转义斜杠的文件夹：name 解码、parentKey 不被字面斜杠截断', () => {
    const key = 'bar/a%2Fb';
    const diff = computeDiff(new Map(), new Map(), null, new Set([key]), new Map(), null);

    expect(diff.toAddFolders[0].name).toBe('a/b');
    expect(diff.toAddFolders[0].parentKey).toBeNull();
  });
});

describe('computeDiff 后续同步（三次 diff）', () => {
  it('服务端新增（快照没有）→ 添加', () => {
    const server = new Map([bm(SERVER_BAR, 'Page', 'https://a.com/page', 'a.com', 'bar')]);
    const browser = new Map<string, DiffBrowserEntry>();
    const snapshot = new Map<string, DiffSnapshotEntry>();
    const diff = computeDiff(server, browser, snapshot, new Set(), new Map(), new Map());

    expect(diff.toAddBookmarks).toHaveLength(1);
  });

  it('服务端删除（快照有、服务端无、浏览器有）→ 删除', () => {
    const snapshot = new Map([snap(SERVER_BAR, 'Page')]);
    const browser = new Map([br(SERVER_BAR, 'Page', 'b1')]);
    const diff = computeDiff(new Map(), browser, snapshot, new Set(), new Map(), new Map());

    expect(diff.toRemoveBookmarks).toHaveLength(1);
    expect(diff.toRemoveBookmarks[0].browserId).toBe('b1');
  });

  it('仅浏览器本地有、快照也没有的书签 → 不添加也不删除（本地新增安全）', () => {
    const server = new Map<string, DiffBookmarkEntry>();
    const browser = new Map([br('bar/local/x', 'Local', 'b1')]);
    const snapshot = new Map<string, DiffSnapshotEntry>();
    const diff = computeDiff(server, browser, snapshot, new Set(), new Map(), new Map());

    expect(diff.toAddBookmarks).toHaveLength(0);
    expect(diff.toRemoveBookmarks).toHaveLength(0);
  });

  it('服务端与快照都有、本地手动删除的书签 → 不复活', () => {
    const server = new Map([bm(SERVER_BAR, 'Page', 'https://a.com/page', 'a.com', 'bar')]);
    const browser = new Map<string, DiffBrowserEntry>(); // 本地已删
    const snapshot = new Map([snap(SERVER_BAR, 'Page')]);
    const diff = computeDiff(server, browser, snapshot, new Set(), new Map(), new Map());

    expect(diff.toAddBookmarks).toHaveLength(0);
    expect(diff.toRemoveBookmarks).toHaveLength(0);
  });

  it('标题更新需同时满足：快照旧、服务端新、浏览器仍是旧值', () => {
    const server = new Map([bm(SERVER_BAR, '新', 'https://a.com/page', 'a.com', 'bar')]);
    const browser = new Map([br(SERVER_BAR, '旧', 'b1')]);
    const snapshot = new Map([snap(SERVER_BAR, '旧')]);
    const diff = computeDiff(server, browser, snapshot, new Set(), new Map(), new Map());

    expect(diff.toUpdateTitles).toHaveLength(1);
    expect(diff.toUpdateTitles[0].newTitle).toBe('新');
  });

  it('浏览器标题已与服务端一致 → 不重复更新', () => {
    const server = new Map([bm(SERVER_BAR, '新', 'https://a.com/page', 'a.com', 'bar')]);
    const browser = new Map([br(SERVER_BAR, '新', 'b1')]);
    const snapshot = new Map([snap(SERVER_BAR, '旧')]);
    const diff = computeDiff(server, browser, snapshot, new Set(), new Map(), new Map());

    expect(diff.toUpdateTitles).toHaveLength(0);
  });

  it('服务端删除的文件夹（快照有、服务端无、浏览器存在）→ 删除', () => {
    const snapshotFolders = new Map<string, object>([[SERVER_FOLDER, {}]]);
    const browserFolders = new Map([[SERVER_FOLDER, { browserId: 'f1' }]]);
    const diff = computeDiff(new Map(), new Map(), new Map(), new Set(), browserFolders, snapshotFolders);

    expect(diff.toRemoveFolders).toHaveLength(1);
    expect(diff.toRemoveFolders[0].browserId).toBe('f1');
  });

  it('浏览器已有同名文件夹 → 不重复创建', () => {
    const serverFolders = new Set([SERVER_FOLDER]);
    const browserFolders = new Map([[SERVER_FOLDER, { browserId: 'f1' }]]);
    const snapshotFolders = new Map<string, object>();
    const diff = computeDiff(new Map(), new Map(), new Map(), serverFolders, browserFolders, snapshotFolders);

    expect(diff.toAddFolders).toHaveLength(0);
  });
});
