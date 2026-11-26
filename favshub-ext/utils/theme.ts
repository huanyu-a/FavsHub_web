import { storage } from '#imports';
import { baseUrlStorage } from '@/utils/storage';

export type ThemeMode = 'warm' | 'system' | 'website';
export type ResolvedTheme = 'light' | 'dark';

export interface FavsHubThemeTokens {
  bg: string;
  surface: string;
  surfaceSoft: string;
  primary: string;
  primaryHover: string;
  primaryPressed: string;
  text: string;
  textSecondary: string;
  border: string;
}

export const themeModeStorage = storage.defineItem<ThemeMode>('local:POPUP_THEME_MODE', {
  fallback: 'warm',
});

const THEME_TOKENS: Record<ResolvedTheme, FavsHubThemeTokens> = {
  light: {
    bg: '#F8F7F4',
    surface: '#FFFFFF',
    surfaceSoft: '#F0FDF4',
    primary: '#047857',
    primaryHover: '#065F46',
    primaryPressed: '#064E3B',
    text: '#1F2937',
    textSecondary: '#6B7280',
    border: '#E7E5E4',
  },
  dark: {
    bg: '#141714',
    surface: '#1C211E',
    surfaceSoft: '#16352A',
    primary: '#34D399',
    primaryHover: '#6EE7B7',
    primaryPressed: '#10B981',
    text: '#F3F0E9',
    textSecondary: '#B5B9B2',
    border: '#3B423D',
  },
};

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'system' || value === 'website' || value === 'warm' ? value : 'warm';
}

export function getThemeTokens(theme: ResolvedTheme): FavsHubThemeTokens {
  return THEME_TOKENS[theme];
}

export function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function themeCssVariables(theme: ResolvedTheme): Record<string, string> {
  const tokens = getThemeTokens(theme);
  return {
    '--fh-bg': tokens.bg,
    '--fh-surface': tokens.surface,
    '--fh-surface-soft': tokens.surfaceSoft,
    '--fh-primary': tokens.primary,
    '--fh-primary-hover': tokens.primaryHover,
    '--fh-primary-pressed': tokens.primaryPressed,
    '--fh-text': tokens.text,
    '--fh-text-secondary': tokens.textSecondary,
    '--fh-border': tokens.border,
  };
}

/** Apply the effective theme above the static popup defaults without editing style.css. */
export function applyThemeToDocument(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.dataset.favshubTheme = theme;
  root.style.colorScheme = theme;
  for (const [name, value] of Object.entries(themeCssVariables(theme))) {
    root.style.setProperty(name, value);
  }
}

export interface WebsiteThemeSnapshot {
  cookieValue: unknown;
  storedTheme: unknown;
  domTheme: unknown;
  systemDark: unknown;
}

/** Decode and resolve only theme values; malformed cookies must not block other sources. */
export function resolveWebsiteThemeSnapshot(snapshot: WebsiteThemeSnapshot | null | undefined): ResolvedTheme | null {
  if (!snapshot) return null;
  let cookieTheme: string | null = null;
  try {
    cookieTheme = typeof snapshot.cookieValue === 'string' ? decodeURIComponent(snapshot.cookieValue) : null;
  } catch {}
  const storedTheme = typeof snapshot.storedTheme === 'string' ? snapshot.storedTheme : null;
  const preferred = cookieTheme || storedTheme;
  if (preferred === 'light' || preferred === 'dark') return preferred;
  if (snapshot.domTheme === 'light' || snapshot.domTheme === 'dark') return snapshot.domTheme;
  if (preferred === 'auto') return snapshot.systemDark === true ? 'dark' : 'light';
  return null;
}

export function parseWebsiteThemeMessage(value: unknown): ResolvedTheme | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as { action?: unknown; theme?: unknown };
  if (message.action !== 'favshubWebsiteThemeChanged') return null;
  return message.theme === 'light' || message.theme === 'dark' ? message.theme : null;
}

export function isSameOriginHttpUrl(candidate: string, configuredBase: string): boolean {
  try {
    const url = new URL(candidate);
    const base = new URL(configuredBase);
    return ['http:', 'https:'].includes(url.protocol)
      && ['http:', 'https:'].includes(base.protocol)
      && url.origin === base.origin;
  } catch {
    return false;
  }
}

/** Verify both the message sender and the currently active tab before refreshing. */
export async function isActiveWebsiteTab(tabId: number, senderUrl: string): Promise<boolean> {
  try {
    const [baseUrl, tabs] = await Promise.all([
      baseUrlStorage.getValue(),
      browser.tabs.query({ active: true, currentWindow: true }),
    ]);
    const activeTab = tabs[0];
    if (!baseUrl?.trim() || activeTab?.id !== tabId || !activeTab.url) return false;
    return isSameOriginHttpUrl(senderUrl, baseUrl) && isSameOriginHttpUrl(activeTab.url, baseUrl);
  } catch {
    return false;
  }
}

/**
 * Read the configured FavsHub site's effective theme from its active same-origin tab.
 * DOM/localStorage access happens in an isolated world; failures deliberately return null.
 */
export async function readActiveWebsiteTheme(): Promise<ResolvedTheme | null> {
  try {
    const [baseUrl, tabs] = await Promise.all([
      baseUrlStorage.getValue(),
      browser.tabs.query({ active: true, currentWindow: true }),
    ]);
    const tab = tabs[0];
    if (!baseUrl?.trim() || tab?.id == null || !tab.url || !isSameOriginHttpUrl(tab.url, baseUrl)) return null;

    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: (): WebsiteThemeSnapshot => {
        const domTheme = document.documentElement.getAttribute('data-theme');
        let cookieValue: string | null = null;
        let storedTheme: string | null = null;
        try {
          const cookie = document.cookie.match(/(?:^|;\s*)fh_theme=([^;]*)/);
          cookieValue = cookie ? cookie[1] : null;
        } catch {}
        try {
          storedTheme = window.localStorage.getItem('favshub_theme');
        } catch {}
        const systemDark = typeof window.matchMedia === 'function'
          && window.matchMedia('(prefers-color-scheme: dark)').matches;
        return { domTheme, cookieValue, storedTheme, systemDark };
      },
    });
    return resolveWebsiteThemeSnapshot(injection?.result);
  } catch {
    return null;
  }
}
