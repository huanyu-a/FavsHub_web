import { normalizeChangeSummary, type ChangeSummary } from '@/utils/sync-preview';

export type SyncDirection = 'upload' | 'download';

/** 仅包含同步元数据；不得加入 token、密码、书签标题或 URL。 */
export interface SyncHistoryEntry {
  direction: SyncDirection;
  timestamp: number;
  summary: ChangeSummary;
  iconsUploaded: number;
}

export interface SyncActivity {
  history: SyncHistoryEntry[];
  lastSyncAt: number;
}

export const SYNC_HISTORY_LIMIT = 5;

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return SYNC_HISTORY_LIMIT;
  return Math.min(20, Math.max(1, Math.floor(limit)));
}

function sanitizeEntry(value: unknown): SyncHistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SyncHistoryEntry>;
  if (candidate.direction !== 'upload' && candidate.direction !== 'download') return null;
  const timestamp = toCount(candidate.timestamp);
  if (!timestamp) return null;
  return {
    direction: candidate.direction,
    timestamp,
    summary: normalizeChangeSummary(candidate.summary || {}),
    iconsUploaded: toCount(candidate.iconsUploaded),
  };
}

export function createSyncHistoryEntry(
  direction: SyncDirection,
  summary: ChangeSummary,
  timestamp: number,
  iconsUploaded = 0,
): SyncHistoryEntry {
  if (direction !== 'upload' && direction !== 'download') {
    throw new Error('Unknown sync direction');
  }
  const normalizedTimestamp = toCount(timestamp);
  if (!normalizedTimestamp) throw new Error('Invalid sync timestamp');
  return {
    direction,
    timestamp: normalizedTimestamp,
    summary: normalizeChangeSummary(summary),
    iconsUploaded: toCount(iconsUploaded),
  };
}

/** 清洗持久化数据并显式挑选字段，避免旧数据或意外字段进入 UI。 */
export function normalizeSyncHistory(value: unknown, limit = SYNC_HISTORY_LIMIT): SyncHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map(sanitizeEntry)
    .filter((entry): entry is SyncHistoryEntry => entry !== null);
  return normalized.slice(0, normalizeLimit(limit));
}

export function appendSyncHistory(
  history: unknown,
  entry: SyncHistoryEntry,
  limit = SYNC_HISTORY_LIMIT,
): SyncHistoryEntry[] {
  const nextEntry = createSyncHistoryEntry(
    entry.direction,
    entry.summary,
    entry.timestamp,
    entry.iconsUploaded,
  );
  return normalizeSyncHistory([nextEntry, ...normalizeSyncHistory(history, 20)], limit);
}

export interface SyncHistoryStore {
  getValue(): Promise<SyncHistoryEntry[]>;
  setValue(value: SyncHistoryEntry[]): Promise<void>;
}

export async function loadSyncActivity(store: SyncHistoryStore): Promise<SyncActivity> {
  const history = normalizeSyncHistory(await store.getValue());
  return { history, lastSyncAt: history[0]?.timestamp || 0 };
}

export async function recordSyncSuccess(
  store: SyncHistoryStore,
  direction: SyncDirection,
  summary: ChangeSummary,
  iconsUploaded = 0,
): Promise<SyncActivity> {
  const entry = createSyncHistoryEntry(direction, summary, Date.now(), iconsUploaded);
  // 读取失败必须中止，禁止把未知旧历史当空数组后覆盖。
  const current: unknown = await store.getValue();
  const history = appendSyncHistory(current, entry);
  await store.setValue(history);
  return { history, lastSyncAt: entry.timestamp };
}
