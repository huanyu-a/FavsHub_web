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
export const userInfoStorage = storage.defineItem<{ id: number; username: string; email?: string }>('local:USER_INFO', {
  fallback: null,
});
