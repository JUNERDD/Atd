import { STORAGE_KEYS } from '../../messages/ports.ts';

/**
 * Where the HUD rests: one of six anchors (top or bottom × left, centre or right). The person
 * moves it by dragging or with the keyboard; it is remembered per site in `chrome.storage.local`.
 */
export type Vertical = 'top' | 'bottom';
export type Horizontal = 'left' | 'center' | 'right';
export interface Anchor {
  v: Vertical;
  h: Horizontal;
}

export const HOME: Anchor = { v: 'bottom', h: 'center' };

const HORIZONTAL: readonly Horizontal[] = ['left', 'center', 'right'];

export type Arrow = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

export function isArrow(key: string): key is Arrow {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown';
}

/** One anchor per key press: ←/→ step through left, centre and right; ↑/↓ pick top or bottom. */
export function stepAnchor(at: Anchor, key: Arrow): Anchor {
  const index =
    HORIZONTAL.indexOf(at.h) + (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0);
  return {
    v: key === 'ArrowUp' ? 'top' : key === 'ArrowDown' ? 'bottom' : at.v,
    h: HORIZONTAL[Math.max(0, Math.min(2, index))] ?? at.h,
  };
}

/** The anchor for a resting point (the HUD's centre after its momentum) in a viewport. */
export function anchorAt(x: number, y: number, width: number, height: number): Anchor {
  const h: Horizontal = x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : 'center';
  return { v: y < height / 2 ? 'top' : 'bottom', h };
}

export function sameAnchor(a: Anchor, b: Anchor): boolean {
  return a.v === b.v && a.h === b.h;
}

/** Sites with an opaque origin (file:, data:) share no key, so their position is not kept. */
function storageKey(): string | null {
  const origin = location.origin;
  return origin && origin !== 'null' ? STORAGE_KEYS.hudPosition + origin : null;
}

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) return false;
  const { v, h } = value as Record<string, unknown>;
  return (v === 'top' || v === 'bottom') && (h === 'left' || h === 'center' || h === 'right');
}

export async function loadAnchor(): Promise<Anchor> {
  const key = storageKey();
  if (!key) return HOME;
  try {
    const stored = await chrome.storage.local.get(key);
    const value: unknown = stored[key];
    return isAnchor(value) ? value : HOME;
  } catch {
    return HOME;
  }
}

export function saveAnchor(at: Anchor): void {
  const key = storageKey();
  if (!key) return;
  // The default place is not stored: a reset site forgets its entry.
  const write = sameAnchor(at, HOME)
    ? chrome.storage.local.remove(key)
    : chrome.storage.local.set({ [key]: at });
  write.catch(() => {
    // The extension context went away; the position simply isn't kept.
  });
}
