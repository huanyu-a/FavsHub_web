import zh from '@/i18n/locales/zh';
import en from '@/i18n/locales/en';
import { storage } from '#imports';
import type { AppLanguage } from '@/utils/storage';

/**
 * 服务端错误码 → 当前语言文案。
 * 独立实现而不依赖 vue-i18n：request.ts 同时被 background 与 popup 使用，
 * 引入完整 i18n 运行时（含消息编译器）会让 service worker 体积膨胀近 10 倍。
 */
const dictionaries: Record<AppLanguage, Record<string, string>> = {
  zh: zh as Record<string, string>,
  en: en as Record<string, string>,
};

/** 当前语言：优先用户显式选择，从未选择时跟随浏览器语言 */
export async function currentLanguage(): Promise<AppLanguage> {
  const saved = await storage.getItem<string | null>('local:LANGUAGE');
  if (saved === 'zh' || saved === 'en') return saved;
  if (typeof navigator !== 'undefined' && navigator.language?.startsWith('zh')) return 'zh';
  return 'en';
}

export async function translateServerError(code: string): Promise<string> {
  const dict = dictionaries[await currentLanguage()] ?? dictionaries.zh;
  return dict[code] || code;
}

/** 同步翻译：语言已确定时使用（背景页构建菜单等场景） */
export function translateWith(
  lang: AppLanguage,
  key: string,
  params?: Record<string, string | number>,
): string {
  const dict = dictionaries[lang] ?? dictionaries.zh;
  let text = dict?.[key] ?? dictionaries.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** 异步翻译：自动取当前语言 */
export async function tr(key: string, params?: Record<string, string | number>): Promise<string> {
  return translateWith(await currentLanguage(), key, params);
}
