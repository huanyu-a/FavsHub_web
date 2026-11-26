import type { SyncDirection } from '@/utils/sync-history';

export type SyncMutexErrorCode = 'SYNC_BUSY' | 'SYNC_LOCK_UNAVAILABLE';

export interface SyncOperation {
  id: string;
  direction: SyncDirection;
  consumed: boolean;
}

export class SyncMutexError extends Error {
  constructor(readonly code: SyncMutexErrorCode) {
    super(code);
    this.name = 'SyncMutexError';
  }
}

export interface SyncLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: { name: string } | null) => Promise<T>,
  ): Promise<T>;
}

let activeOperation: SyncOperation | null = null;
let nextOperationId = 0;

export function createSyncOperation(direction: SyncDirection): SyncOperation {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  return {
    id: randomUUID || `sync-${Date.now()}-${++nextOperationId}`,
    direction,
    consumed: false,
  };
}

/** 同步消费，重复点击确认不会启动第二次执行。 */
export function consumeSyncOperation(operation: SyncOperation): boolean {
  if (operation.consumed) return false;
  operation.consumed = true;
  return true;
}

/**
 * 本视图占用在首个 await 前生效；Web Locks 负责 popup/side-panel 跨视图互斥。
 * 不支持 Web Locks 时失败关闭，不伪装成安全互斥。
 */
export async function withSyncOperationLock<T>(
  operation: SyncOperation,
  task: () => Promise<T>,
  lockManager?: SyncLockManager,
): Promise<T> {
  if (activeOperation) throw new SyncMutexError('SYNC_BUSY');
  activeOperation = operation;
  try {
    const manager = lockManager ?? globalThis.navigator?.locks as SyncLockManager | undefined;
    if (!manager?.request) throw new SyncMutexError('SYNC_LOCK_UNAVAILABLE');
    return await manager.request('favshub:bookmark-sync', { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) throw new SyncMutexError('SYNC_BUSY');
      return task();
    });
  } finally {
    if (activeOperation === operation) activeOperation = null;
  }
}
