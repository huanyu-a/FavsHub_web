/**
 * 书签列表 favicon 渲染辅助（Home.vue 与 FolderItem.vue 共用）。
 * 优先使用扩展本地 /_favicon/ 缓存，失败时由 handleFaviconError 回退到
 * Google favicon 服务，最终回退为标题首字母占位。
 */

/** 优先用扩展 favicon API（本地缓存，速度快） */
export function getFaviconUrl(url: string): string {
  try {
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    faviconUrl.searchParams.set('pageUrl', url);
    faviconUrl.searchParams.set('size', '32');
    faviconUrl.searchParams.set('cache', '1');
    return faviconUrl.toString();
  } catch {
    return getFallbackFaviconUrl(url);
  }
}

/** 回退：Google favicon 服务 */
export function getFallbackFaviconUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return '';
  }
}

/** 标题首字母占位符 */
export function getBookmarkInitial(title: string): string {
  return title.charAt(0).toUpperCase();
}

/** favicon 加载失败：先回退 Google 服务，再失败则显示首字母占位 */
export function handleFaviconError(e: Event): void {
  const img = e.target as HTMLImageElement;
  const currentSrc = img.src;
  if (currentSrc.includes('chrome-extension://') || currentSrc.includes('/_favicon/')) {
    // 从 URL 中提取 pageUrl 参数
    try {
      const u = new URL(currentSrc);
      const pageUrl = u.searchParams.get('pageUrl');
      if (pageUrl) {
        img.src = getFallbackFaviconUrl(pageUrl);
        return;
      }
    } catch {}
  }
  // 最终回退：显示首字母
  img.style.display = 'none';
  const fallback = img.nextElementSibling as HTMLElement;
  if (fallback) fallback.style.display = 'flex';
}
