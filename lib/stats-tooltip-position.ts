interface StatsTooltipAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface StatsTooltipSize {
  width: number;
  height: number;
}

export interface StatsTooltipPlacement {
  left: number;
  top: number;
  side: "right" | "left" | "top" | "bottom";
}

/** Place beside the complete anchor without covering it or leaving the viewport. */
export function getStatsTooltipPlacement(
  anchor: StatsTooltipAnchor,
  size: StatsTooltipSize,
  viewport: StatsTooltipSize,
  gap = 8,
  gutter = 8,
): StatsTooltipPlacement | null {
  const width = anchor.right - anchor.left;
  const height = anchor.bottom - anchor.top;
  if (
    ![
      anchor.left, anchor.right, anchor.top, anchor.bottom, width, height,
      size.width, size.height, viewport.width, viewport.height, gap, gutter,
    ].every(Number.isFinite) ||
    width <= 0 || height <= 0 || size.width <= 0 || size.height <= 0 ||
    viewport.width <= 0 || viewport.height <= 0 || gap < 0 || gutter < 0 ||
    anchor.right <= 0 || anchor.left >= viewport.width ||
    anchor.bottom <= 0 || anchor.top >= viewport.height
  ) return null;

  const maxLeft = viewport.width - gutter - size.width;
  const maxTop = viewport.height - gutter - size.height;
  if (maxLeft < gutter || maxTop < gutter) return null;

  const clamp = (value: number, maximum: number) => Math.max(gutter, Math.min(value, maximum));
  const centeredLeft = clamp(anchor.left + width / 2 - size.width / 2, maxLeft);
  const centeredTop = clamp(anchor.top + height / 2 - size.height / 2, maxTop);
  const candidates: StatsTooltipPlacement[] = [
    { side: "right", left: Math.max(gutter, anchor.right + gap), top: centeredTop },
    { side: "left", left: Math.min(maxLeft, anchor.left - gap - size.width), top: centeredTop },
    { side: "top", left: centeredLeft, top: Math.min(maxTop, anchor.top - gap - size.height) },
    { side: "bottom", left: centeredLeft, top: Math.max(gutter, anchor.bottom + gap) },
  ];

  return candidates.find(({ left, top }) => (
    left >= gutter && left <= maxLeft && top >= gutter && top <= maxTop
  )) ?? null;
}
