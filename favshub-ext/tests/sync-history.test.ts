import { describe, expect, it, vi } from 'vitest';
import {
  appendSyncHistory,
  createSyncHistoryEntry,
  loadSyncActivity,
  normalizeSyncHistory,
  recordSyncSuccess,
  SYNC_HISTORY_LIMIT,
  type SyncHistoryEntry,
} from '@/utils/sync-history';
import { normalizeChangeSummary } from '@/utils/sync-preview';

function entry(timestamp: number, direction: 'upload' | 'download' = 'upload'): SyncHistoryEntry {
  return createSyncHistoryEntry(direction, normalizeChangeSummary({ added: 1 }), timestamp);
}

describe('同步历史元数据', () => {
  it('创建记录时只保留方向、时间、计数和图标数', () => {
    const result = createSyncHistoryEntry('upload', normalizeChangeSummary({
      added: 1.8,
      deleted: -2,
    }), 1000.9, 3.7);

    expect(result).toEqual({
      direction: 'upload',
      timestamp: 1000,
      summary: {
        added: 1,
        updated: 0,
        moved: 0,
        deleted: 0,
        foldersAdded: 0,
        foldersDeleted: 0,
      },
      iconsUploaded: 3,
    });
    expect(Object.keys(result)).not.toEqual(expect.arrayContaining(['token', 'password', 'url', 'title']));
  });

  it('拒绝非法方向与无效时间戳', () => {
    expect(() => createSyncHistoryEntry('other' as 'upload', normalizeChangeSummary({}), 1)).toThrow('Unknown sync direction');
    expect(() => createSyncHistoryEntry('upload', normalizeChangeSummary({}), 0)).toThrow('Invalid sync timestamp');
  });

  it('清洗损坏记录并剔除意外敏感字段', () => {
    const dirty = [{
      ...entry(1),
      token: 'secret',
      password: 'secret',
      url: 'https://private.example',
      title: 'private',
    }, null, { direction: 'invalid', timestamp: 2 }, { direction: 'upload', timestamp: 0 }];

    const result = normalizeSyncHistory(dirty);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(entry(1));
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('新记录置顶并限制最近条数，且不修改输入数组', () => {
    const original = [entry(1), entry(2)];
    const before = structuredClone(original);
    const result = appendSyncHistory(original, entry(3, 'download'), 2);

    expect(result.map((item) => item.timestamp)).toEqual([3, 1]);
    expect(original).toEqual(before);
  });

  it('默认保留最近五条，非法上限回退默认值', () => {
    const original = Array.from({ length: 8 }, (_, index) => entry(index + 1));
    expect(normalizeSyncHistory(original)).toHaveLength(SYNC_HISTORY_LIMIT);
    expect(appendSyncHistory(original, entry(9)).map((item) => item.timestamp)).toEqual([9, 1, 2, 3, 4]);
    expect(normalizeSyncHistory(original, 0)).toHaveLength(SYNC_HISTORY_LIMIT);
  });

  it('非数组历史安全返回空态', () => {
    expect(normalizeSyncHistory({ history: [] })).toEqual([]);
    expect(normalizeSyncHistory(null)).toEqual([]);
  });

  it('历史读取或写入异常均向上传递，读取失败不会覆盖旧历史', async () => {
    const setValue = vi.fn(async () => {});
    await expect(recordSyncSuccess({
      getValue: vi.fn(async () => { throw new Error('read failed'); }),
      setValue,
    }, 'upload', normalizeChangeSummary({ added: 1 }))).rejects.toThrow('read failed');
    expect(setValue).not.toHaveBeenCalled();

    await expect(recordSyncSuccess({
      getValue: vi.fn(async () => [entry(1)]),
      setValue: vi.fn(async () => { throw new Error('write failed'); }),
    }, 'download', normalizeChangeSummary({ deleted: 1 }))).rejects.toThrow('write failed');

    await expect(loadSyncActivity({
      getValue: vi.fn(async () => { throw new Error('load failed'); }),
      setValue,
    })).rejects.toThrow('load failed');
  });
});
