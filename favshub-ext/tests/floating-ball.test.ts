import { describe, expect, it } from 'vitest';
import {
  clampFloatingTop,
  getFloatingTooltipTop,
  shouldHandleFloatingButtonKeydown,
} from '@/utils/floating-ball';

describe('floating ball keyboard isolation', () => {
  it('handles Enter and Space only on the floating button itself', () => {
    const button = new EventTarget();
    const closeButton = new EventTarget();

    expect(shouldHandleFloatingButtonKeydown('Enter', button, button)).toBe(true);
    expect(shouldHandleFloatingButtonKeydown(' ', button, button)).toBe(true);
    expect(shouldHandleFloatingButtonKeydown('Enter', closeButton, button)).toBe(false);
    expect(shouldHandleFloatingButtonKeydown(' ', closeButton, button)).toBe(false);
    expect(shouldHandleFloatingButtonKeydown('Escape', button, button)).toBe(false);
  });
});

describe('floating ball viewport clamping', () => {
  it('keeps the button inside the viewport after dragging and resizing', () => {
    expect(clampFloatingTop(-20, 800, 44)).toBe(12);
    expect(clampFloatingTop(900, 800, 44)).toBe(744);
    expect(clampFloatingTop(900, 240, 44)).toBe(184);
  });

  it('clamps tooltip offset at both viewport edges', () => {
    expect(getFloatingTooltipTop(12, 44, 160, 240)).toBe(-4);
    expect(getFloatingTooltipTop(184, 44, 160, 240)).toBe(-112);
  });

  it('keeps an oversized tooltip at the top margin in a 320x240 viewport', () => {
    // CSS caps its real height at 224px; the pure layout helper also remains safe for larger measurements.
    expect(getFloatingTooltipTop(100, 44, 300, 240)).toBe(-92);
  });
});
