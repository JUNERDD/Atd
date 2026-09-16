export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanelSize {
  width: number;
  height: number;
}

export const PANEL_SIZE = { width: 420, height: 580 } as const;
export const PANEL_MIN_SIZE = { width: 320, height: 400 } as const;
export const PANEL_MARGIN = 16;

export function constrainPanelBounds(bounds: WorkArea, workArea: WorkArea): WorkArea {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

/**
 * The resize floor stays inside the work area so a small display never leaves
 * an unreachable minimum for the native window.
 */
export function getPanelMinimumSize(workArea: WorkArea): PanelSize {
  return {
    width: Math.min(PANEL_MIN_SIZE.width, workArea.width),
    height: Math.min(PANEL_MIN_SIZE.height, workArea.height),
  };
}

/**
 * Docks the panel in the bottom-right corner of the work area. A stored size is
 * kept inside the supported size range; when the minimum plus both margins no
 * longer fits, the panel yields the margin instead of leaving the work area.
 */
export function getPanelBounds(workArea: WorkArea, size: PanelSize = PANEL_SIZE): WorkArea {
  const margin = Math.min(PANEL_MARGIN, Math.floor(Math.min(workArea.width, workArea.height) / 4));
  const minimum = getPanelMinimumSize(workArea);
  const width = Math.max(minimum.width, Math.min(size.width, workArea.width - margin * 2));
  const height = Math.max(minimum.height, Math.min(size.height, workArea.height - margin * 2));

  return {
    x: Math.max(workArea.x, workArea.x + workArea.width - width - margin),
    y: Math.max(workArea.y, workArea.y + workArea.height - height - margin),
    width,
    height,
  };
}
