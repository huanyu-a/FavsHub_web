import { describe, it, expect } from 'vitest';
import { flattenBookmarks } from '@/utils/flatten-bookmarks';

const iconFn = (url: string) => `icon:${url}`;

function node(partial: Partial<chrome.bookmarks.BookmarkTreeNode> & { id: string; title: string }): chrome.bookmarks.BookmarkTreeNode {
  return partial as chrome.bookmarks.BookmarkTreeNode;
}

const TREE: chrome.bookmarks.BookmarkTreeNode[] = [
  node({
    id: '0',
    title: '',
    children: [
      node({
        id: '1',
        title: '书签栏',
        children: [
          node({ id: '10', title: '栏顶书签', url: 'https://top.example.com' }),
          node({
            id: '11',
            title: '工作',
            children: [
              node({ id: '110', title: '文档', url: 'https://doc.example.com' }),
              node({
                id: '111',
                title: '子文件夹',
                children: [node({ id: '1110', title: '深层', url: 'https://deep.example.com' })],
              }),
            ],
          }),
        ],
      }),
      node({
        id: '2',
        title: '其他书签',
        children: [node({ id: '20', title: '其他书签', url: 'https://other.example.com' })],
      }),
    ],
  }),
];

describe('flattenBookmarks', () => {
  const flat = flattenBookmarks(TREE, iconFn);
  const byId = new Map(flat.map((b) => [b.browserId!, b]));

  it('容器直属书签：folder_path 为空、container 正确', () => {
    const top = byId.get('10')!;
    expect(top.folder_path).toBeUndefined();
    expect(top.container).toBe('bar');
    expect(top.url).toBe('https://top.example.com');
  });

  it('顶级文件夹提升：folder_path 不含容器名前缀', () => {
    const doc = byId.get('110')!;
    expect(doc.folder_path).toBe('工作');
    expect(doc.container).toBe('bar');
  });

  it('嵌套文件夹路径用 / 连接', () => {
    expect(byId.get('1110')!.folder_path).toBe('工作/子文件夹');
  });

  it('其他容器标记为 other', () => {
    expect(byId.get('20')!.container).toBe('other');
  });

  it('icon 由注入的 iconFn 生成，sort_order 单调递增', () => {
    expect(byId.get('110')!.icon).toBe('icon:https://doc.example.com');
    const orders = flat.map((b) => b.sort_order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it('browserId 保留浏览器节点 ID（增量 diff 依赖）', () => {
    expect(flat.every((b) => typeof b.browserId === 'string')).toBe(true);
  });
});
