import { describe, expect, it } from 'vitest';
import {
  isSameOriginHttpUrl,
  parseWebsiteThemeMessage,
  resolveWebsiteThemeSnapshot,
} from '@/utils/theme';

describe('website theme snapshot fallback', () => {
  it('falls back to DOM and localStorage when the theme cookie is malformed', () => {
    expect(resolveWebsiteThemeSnapshot({
      cookieValue: '%E0%A4%A',
      storedTheme: null,
      domTheme: 'dark',
      systemDark: false,
    })).toBe('dark');

    expect(resolveWebsiteThemeSnapshot({
      cookieValue: '%E0%A4%A',
      storedTheme: 'light',
      domTheme: null,
      systemDark: true,
    })).toBe('light');
  });

  it('resolves auto from the system and ignores unsupported values', () => {
    expect(resolveWebsiteThemeSnapshot({
      cookieValue: 'auto', storedTheme: null, domTheme: null, systemDark: true,
    })).toBe('dark');
    expect(resolveWebsiteThemeSnapshot({
      cookieValue: 'blue', storedTheme: null, domTheme: null, systemDark: true,
    })).toBeNull();
  });
});

describe('website theme message validation', () => {
  it('accepts only the dedicated action with a light/dark enum', () => {
    expect(parseWebsiteThemeMessage({ action: 'favshubWebsiteThemeChanged', theme: 'dark' })).toBe('dark');
    expect(parseWebsiteThemeMessage({ action: 'favshubWebsiteThemeChanged', theme: 'blue' })).toBeNull();
    expect(parseWebsiteThemeMessage({ action: 'proxyFetch', theme: 'dark' })).toBeNull();
  });

  it('requires an HTTP(S) URL on the configured site origin', () => {
    expect(isSameOriginHttpUrl('https://favs.example/path', 'https://favs.example/base')).toBe(true);
    expect(isSameOriginHttpUrl('https://other.example/path', 'https://favs.example/base')).toBe(false);
    expect(isSameOriginHttpUrl('javascript:alert(1)', 'https://favs.example')).toBe(false);
    expect(isSameOriginHttpUrl('not a url', 'https://favs.example')).toBe(false);
  });
});
