export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PANEL_SIZE = { width: 420, height: 580 } as const;
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

export function getPanelBounds(workArea: WorkArea): WorkArea {
  const margin = Math.min(PANEL_MARGIN, Math.floor(Math.min(workArea.width, workArea.height) / 4));
  const width = Math.min(PANEL_SIZE.width, workArea.width - margin * 2);
  const height = Math.min(PANEL_SIZE.height, workArea.height - margin * 2);

  return {
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin,
    width,
    height,
  };
}
