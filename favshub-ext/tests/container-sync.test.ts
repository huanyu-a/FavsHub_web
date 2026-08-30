import { describe, it, expect } from 'vitest';
import { containerTypeFromTitle, resolveContainerByType } from '@/utils/container-sync';

describe('containerTypeFromTitle', () => {
  it('Chrome/Edge/Firefox 中文名映射', () => {
    expect(containerTypeFromTitle('书签栏')).toBe('bar');
    expect(containerTypeFromTitle('其他书签')).toBe('other');
    expect(containerTypeFromTitle('移动设备书签')).toBe('mobile');
    expect(containerTypeFromTitle('书签工具栏')).toBe('bar');
    expect(containerTypeFromTitle('书签菜单')).toBe('other');
  });

  it('英文与变体映射', () => {
    expect(containerTypeFromTitle('Bookmarks bar')).toBe('bar');
    expect(containerTypeFromTitle('Bookmarks Bar')).toBe('bar');
    expect(containerTypeFromTitle('Other Bookmarks')).toBe('other');
    expect(containerTypeFromTitle('Mobile bookmarks')).toBe('mobile');
    expect(containerTypeFromTitle('Bookmarks Menu')).toBe('other');
  });

  it('未知容器返回空串（下载路径回退 bar）', () => {
    expect(containerTypeFromTitle('自定义收藏')).toBe('');
    expect(containerTypeFromTitle('')).toBe('');
  });
});

describe('resolveContainerByType', () => {
  const containers = new Map<string, chrome.bookmarks.BookmarkTreeNode>(
    ['书签栏', 'Other bookmarks'].map((title, i) => [title, { id: String(i + 1), title } as chrome.bookmarks.BookmarkTreeNode]),
  );

  it('按候选标题顺序解析到本地节点', () => {
    expect(resolveContainerByType('bar', containers)?.id).toBe('1');
    expect(resolveContainerByType('other', containers)?.id).toBe('2');
  });

  it('本地没有对应容器或类型未知 → null', () => {
    expect(resolveContainerByType('mobile', containers)).toBeNull();
    expect(resolveContainerByType('unknown', containers)).toBeNull();
  });
});
