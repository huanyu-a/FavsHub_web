import { describe, it, expect } from 'vitest';
import { isSafeUrl } from '@/utils/safe-url';

describe('isSafeUrl 协议白名单', () => {
  it('放行 http/https', () => {
    expect(isSafeUrl('http://localhost:3000')).toBe(true);
    expect(isSafeUrl('https://example.com/page?q=1')).toBe(true);
    expect(isSafeUrl('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('拦截伪协议与本地协议', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JaVaScRiPt:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeUrl('file:///C:/Windows')).toBe(false);
    expect(isSafeUrl('chrome-extension://abc/icon.png')).toBe(false);
    expect(isSafeUrl('vbscript:x')).toBe(false);
    expect(isSafeUrl('ftp://example.com')).toBe(false);
  });

  it('拦截空值与非法字符串', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl('not a url')).toBe(false);
    expect(isSafeUrl('//example.com')).toBe(false);
  });
});
