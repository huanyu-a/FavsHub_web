import { storage } from '#imports';

export type AppLanguage = 'zh' | 'en';

export const baseUrlStorage = storage.defineItem<string>('local:BASE_URL', {
  fallback: '',
});

export const tokenStorage = storage.defineItem<string>('local:TOKEN', {
  fallback: '',
});

export const languageStorage = storage.defineItem<AppLanguage>('local:LANGUAGE', {
  fallback: 'zh',
});

// FavsHub 用户信息
export const userInfoStorage = storage.defineItem<{ id: number; username: string; email?: string; is_admin?: boolean }>('local:USER_INFO', {
  fallback: null,
});

// 书签同步快照（用于增量下载的三次 diff）
export interface SyncSnapshotBookmark {
  key: string;    // "${container}/${relativePath}/${url}"
  title: string;
}

export interface SyncSnapshotFolder {
  key: string;    // "${container}/${relativePath}"
}

export interface SyncSnapshot {
  bookmarks: SyncSnapshotBookmark[];
  folders: SyncSnapshotFolder[];
  timestamp: number;
}

export const syncSnapshotStorage = storage.defineItem<SyncSnapshot | null>('local:SYNC_SNAPSHOT', {
  fallback: null,
});

export const lastSyncTimestampStorage = storage.defineItem<number>('local:LAST_SYNC_TIMESTAMP', {
  fallback: 0,
});

// 悬浮球开关（默认开启）
export const enableFloatingBallStorage = storage.defineItem<boolean>('local:ENABLE_FLOATING_BALL', {
  fallback: true,
});
