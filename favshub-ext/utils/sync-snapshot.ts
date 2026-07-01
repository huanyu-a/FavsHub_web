import { syncSnapshotStorage, type SyncSnapshot } from '@/utils/storage';

/** 保存同步快照到扩展存储 */
export async function saveSnapshot(snapshot: SyncSnapshot): Promise<void> {
  await syncSnapshotStorage.setValue(snapshot);
}

/** 加载同步快照，不存在或损坏时返回 null */
export async function loadSnapshot(): Promise<SyncSnapshot | null> {
  try {
    const snapshot = await syncSnapshotStorage.getValue();
    if (snapshot && Array.isArray(snapshot.bookmarks) && Array.isArray(snapshot.folders)) {
      return snapshot;
    }
    return null;
  } catch {
    return null;
  }
}

/** 清除同步快照 */
export async function clearSnapshot(): Promise<void> {
  await syncSnapshotStorage.setValue(null);
}
