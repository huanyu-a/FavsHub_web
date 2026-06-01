export type LinkApiItem = {
  id: number;
  uid: number;
  title: string;
  url: string;
  backup_url: string;
  content: string;
  keywords: string;
  description: string;
  icon: string;
  category_type: 'l1' | 'l2';
  category_id: number;
  sort_order: number;
  is_public: number;
  http_code: number;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BookmarkLink = {
  id: number;
  title: string;
  url: string;
  backupUrl: string;
  content: string;
  keywords: string;
  description: string;
  icon: string;
  categoryType: 'l1' | 'l2';
  categoryId: number;
  sortOrder: number;
  isPublic: number;
  httpCode: number;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function mapLink(item: LinkApiItem): BookmarkLink {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    backupUrl: item.backup_url,
    content: item.content,
    keywords: item.keywords,
    description: item.description,
    icon: item.icon,
    categoryType: item.category_type,
    categoryId: item.category_id,
    sortOrder: item.sort_order,
    isPublic: item.is_public,
    httpCode: item.http_code,
    lastCheckedAt: item.last_checked_at,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function getFaviconUrl(url: string) {
  return `https://t0.gstatic.cn/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&size=32&url=${encodeURIComponent(url)}`;
}
