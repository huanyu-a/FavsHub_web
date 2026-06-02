import { containerTypeFromTitle } from '@/utils/container-sync';

export interface FlatBookmark {
  title: string;
  url: string;
  folder_path?: string;  // "收藏夹栏/自媒体/子文件夹" — 首段为容器名
  container?: string;     // "bar"|"other"|"mobile"|"" — 下载时路由用
  icon?: string;
  sort_order: number;
  browserId?: string;     // 浏览器书签节点 ID（用于增量合并 diff）
}

/**
 * 将浏览器书签树扁平化。
 * folder_path 格式：容器名/文件夹/子文件夹，首段一定是容器名（如"收藏夹栏"）。
 * 服务端 ensureFolderPath 按 / 分割递归创建文件夹。
 */
export function flattenBookmarks(
  tree: chrome.bookmarks.BookmarkTreeNode[],
  iconFn: (url: string) => string,
): FlatBookmark[] {
  const result: FlatBookmark[] = [];
  let index = 0;

  const root = tree[0];
  if (!root?.children) return result;

  for (const container of root.children) {
    const containerName = container.name || container.title;
    const containerType = containerTypeFromTitle(containerName);
    if (!container.children) continue;

    for (const node of container.children) {
      if (node.url) {
        // 容器下直接的未分类书签 → folder_path = 容器名
        result.push({
          title: node.title || node.url,
          url: node.url,
          folder_path: containerName,
          container: containerType,
          icon: iconFn(node.url),
          sort_order: index++,
          browserId: node.id,
        });
      } else if (node.children) {
        // 文件夹 → folder_path = 容器名/文件夹名/...
        walkChildren(node.children, `${containerName}/${node.title}`, containerType);
      }
    }
  }

  function walkChildren(
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    parentPath: string,
    containerType: string,
  ) {
    for (const node of nodes) {
      if (node.url) {
        result.push({
          title: node.title || node.url,
          url: node.url,
          folder_path: parentPath,
          container: containerType,
          icon: iconFn(node.url),
          sort_order: index++,
          browserId: node.id,
        });
      }
      if (node.children) {
        walkChildren(node.children, `${parentPath}/${node.title}`, containerType);
      }
    }
  }

  return result;
}