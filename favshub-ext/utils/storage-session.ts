/**
 * Session-only storage items.
 * IMPORTANT: chrome.storage.session 在 content script 中不可用，
 * 此模块只能在 background / popup / sidepanel 中使用。
 */
import { storage } from '#imports';

export interface FaviconWarmingState {
  running: boolean;
  paused: boolean;
  total: number;
  current: number;
  progressMsg: string;
}

export const faviconWarmingStateStorage = storage.defineItem<FaviconWarmingState>('session:FAVICON_WARMING_STATE', {
  fallback: { running: false, paused: false, total: 0, current: 0, progressMsg: '' },
});
