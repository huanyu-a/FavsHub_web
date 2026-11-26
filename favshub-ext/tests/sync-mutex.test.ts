import { describe, expect, it, vi } from 'vitest';
import {
  consumeSyncOperation,
  createSyncOperation,
  SyncMutexError,
  withSyncOperationLock,
  type SyncLockManager,
} from '@/utils/sync-mutex';

function createManager(): SyncLockManager & { request: ReturnType<typeof vi.fn> } {
  let held = false;
  return {
    request: vi.fn(async (_name, _options, callback) => {
      if (held) return callback(null);
      held = true;
      try {
        return await callback({ name: 'favshub:bookmark-sync' });
      } finally {
        held = false;
      }
    }),
  } as SyncLockManager & { request: ReturnType<typeof vi.fn> };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('同步操作互斥', () => {
  it('在确认等待期间持续持锁，并拒绝同视图另一方向操作', async () => {
    const manager = createManager();
    const confirmation = deferred();
    const started = deferred();
    let writes = 0;
    const first = withSyncOperationLock(createSyncOperation('download'), async () => {
      started.resolve();
      await confirmation.promise;
      writes++;
    }, manager);
    await started.promise;

    await expect(withSyncOperationLock(createSyncOperation('upload'), async () => {
      writes += 100;
    }, manager)).rejects.toMatchObject({ code: 'SYNC_BUSY' });
    expect(writes).toBe(0);
    expect(manager.request).toHaveBeenCalledTimes(1);

    confirmation.resolve();
    await first;
    expect(writes).toBe(1);
  });

  it('一次性操作 ID 防重复确认', () => {
    const operation = createSyncOperation('upload');
    const execute = vi.fn();
    const confirm = () => {
      if (!consumeSyncOperation(operation)) return false;
      execute();
      return true;
    };
    expect(confirm()).toBe(true);
    expect(confirm()).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('跨视图锁被占用时 fail closed，任务不执行', async () => {
    const task = vi.fn(async () => 'unexpected');
    const manager: SyncLockManager = {
      request: async (_name, _options, callback) => callback(null),
    };
    await expect(withSyncOperationLock(createSyncOperation('download'), task, manager))
      .rejects.toEqual(expect.objectContaining<Partial<SyncMutexError>>({ code: 'SYNC_BUSY' }));
    expect(task).not.toHaveBeenCalled();
  });

  it('Web Locks 不可用时 fail closed，任务不执行', async () => {
    const task = vi.fn(async () => 'unexpected');
    await expect(withSyncOperationLock(createSyncOperation('download'), task, {} as SyncLockManager))
      .rejects.toMatchObject({ code: 'SYNC_LOCK_UNAVAILABLE' });
    expect(task).not.toHaveBeenCalled();
  });
});
