export function shouldHandleFloatingButtonKeydown(
  key: string,
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  return target === currentTarget && (key === 'Enter' || key === ' ');
}

export function clampFloatingTop(
  top: number,
  viewportHeight: number,
  buttonHeight: number,
  margin = 12,
): number {
  return Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - buttonHeight - margin));
}

/** Return the tooltip's top offset relative to its floating button. */
export function getFloatingTooltipTop(
  buttonTop: number,
  buttonHeight: number,
  tooltipHeight: number,
  viewportHeight: number,
  margin = 8,
): number {
  const minimum = margin - buttonTop;
  const maximum = Math.max(minimum, viewportHeight - margin - tooltipHeight - buttonTop);
  const centered = buttonHeight / 2 - tooltipHeight / 2;
  return Math.min(Math.max(centered, minimum), maximum);
}
