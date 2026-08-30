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
  /** 心跳时间戳：用于检测预热循环已死（弹窗被关闭）的幽灵状态 */
  beat: number;
}

export const faviconWarmingStateStorage = storage.defineItem<FaviconWarmingState>('session:FAVICON_WARMING_STATE', {
  fallback: { running: false, paused: false, total: 0, current: 0, progressMsg: '', beat: 0 },
});
