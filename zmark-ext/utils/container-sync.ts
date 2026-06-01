/**
 * 容器名 → 容器类型（bar / other / mobile）
 */
const CONTAINER_TYPE_MAP: Record<string, string> = {
  // Chrome / Edge (中文)
  '书签栏': 'bar',
  '其他书签': 'other',
  '移动设备书签': 'mobile',
  // Chrome / Edge / Firefox (英文)
  'Bookmarks bar': 'bar',
  'Bookmarks Bar': 'bar',
  'Other bookmarks': 'other',
  'Other Bookmarks': 'other',
  'Mobile bookmarks': 'mobile',
  'Mobile Bookmarks': 'mobile',
  // Firefox (中文)
  '书签工具栏': 'bar',
  '书签菜单': 'other',
  // Firefox (英文)
  'Bookmarks Toolbar': 'bar',
  'Bookmarks Menu': 'other',
  // Edge 收藏夹
  '收藏夹栏': 'bar',
  '其他收藏夹': 'other',
};

// 本地容器标题 → 类型 → 节点的反向映射（给 browser-sync 用）
const TYPE_TO_LOCAL_TITLES: Record<string, string[]> = {
  bar: ['书签栏', '收藏夹栏', 'Bookmarks bar', 'Bookmarks Bar', '书签工具栏', 'Bookmarks Toolbar'],
  other: ['其他书签', '其他收藏夹', 'Other bookmarks', 'Other Bookmarks', '书签菜单', 'Bookmarks Menu'],
  mobile: ['移动设备书签', 'Mobile bookmarks', 'Mobile Bookmarks'],
};

/**
 * 上行：浏览器容器标题 → 容器类型字符串（"bar" | "other" | "mobile" | ""）
 */
export function containerTypeFromTitle(title: string): string {
  return CONTAINER_TYPE_MAP[title] || '';
}

/**
 * 下行：容器类型 → 当前浏览器中对应的容器节点
 */
export function resolveContainerByType(
  type: string,
  localContainers: Map<string, browser.bookmarks.BookmarkTreeNode>,
): browser.bookmarks.BookmarkTreeNode | null {
  const titles = TYPE_TO_LOCAL_TITLES[type];
  if (!titles) return null;
  for (const t of titles) {
    const c = localContainers.get(t);
    if (c) return c;
  }
  return null;
}