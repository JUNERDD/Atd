import { svgNode, updateBlurFilter, type BlurRegion } from './overlay-blur-filter';

const overlaySelector = [
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="select-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-slot="sheet-content"]',
  '[data-slot="sheet-overlay"]',
  '[data-slot="alert-dialog-content"]',
  '[data-slot="alert-dialog-overlay"]',
  '.cm-tooltip',
].join(',');

interface OverlayMaterial {
  blur: number;
  backdrop: string;
}

interface FilteredLayer {
  filter: SVGFilterElement;
  original: string;
  signature: string;
}

function portalLayer(element: HTMLElement): HTMLElement {
  let layer = element;
  while (layer.parentElement && layer.parentElement !== document.body) layer = layer.parentElement;
  return layer;
}

function backgroundAlpha(color: string): number {
  // CSSOM retains modern color spaces such as Tailwind's oklab(... / alpha).
  const alpha = /\/\s*([\d.]+)(%)?\s*\)$/.exec(color);
  if (alpha) return Number(alpha[1]) / (alpha[2] ? 100 : 1);
  const legacyAlpha = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(color);
  return legacyAlpha ? Number(legacyAlpha[1]) : 1;
}

/** Clamp computed opacity to 0..1 at 2dp; NaN falls back to 1. */
function overlayOpacity(style: CSSStyleDeclaration): number {
  const value = Number(style.opacity);
  if (Number.isNaN(value)) return 1;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/**
 * Electron's transparent backing surface composites CSS backdrop blur over the original pixels.
 * Blur each lower portal layer only inside the overlays above it, preserving native-window alpha.
 * Radix / CodeMirror still own portals, placement, focus, dismissal, and scrolling.
 */
export function installNativeOverlayBlur(root: HTMLElement): () => void {
  const definitions = svgNode('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
  definitions.style.position = 'absolute';
  definitions.style.pointerEvents = 'none';
  document.body.append(definitions);
  const materials = new Map<HTMLElement, OverlayMaterial>();
  const layers = new Map<HTMLElement, FilteredLayer>();
  let nextId = 0;
  let scheduled = 0;
  let disposed = false;

  const schedule = () => {
    if (!scheduled && !disposed) scheduled = requestAnimationFrame(update);
  };
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(root);

  function update() {
    scheduled = 0;
    const overlays = [...document.querySelectorAll<HTMLElement>(overlaySelector)].filter(
      (element) => element.checkVisibility({ visibilityProperty: true }) && element.offsetWidth > 0,
    );
    const visible = new Set(overlays);
    for (const [element, material] of materials) {
      if (visible.has(element)) continue;
      element.style.backdropFilter = material.backdrop;
      resizeObserver.unobserve(element);
      materials.delete(element);
    }
    for (const element of overlays) {
      if (materials.has(element)) continue;
      const blur = /blur\(([\d.]+)px\)/.exec(getComputedStyle(element).backdropFilter);
      if (!blur) continue;
      materials.set(element, { blur: Number(blur[1]), backdrop: element.style.backdropFilter });
      element.style.backdropFilter = 'none';
      resizeObserver.observe(element);
    }

    const ordered = overlays.map((element) => ({
      element,
      layer: portalLayer(element),
      rect: element.getBoundingClientRect(),
      style: getComputedStyle(element),
    }));
    ordered.sort((a, b) => (Number(a.style.zIndex) || 0) - (Number(b.style.zIndex) || 0));
    const layerOrder = [...new Set([root, ...ordered.map(({ layer }) => layer)])];
    const activeLayers = new Set<HTMLElement>();
    for (const [index, layer] of layerOrder.entries()) {
      const rect = layer.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const regions: BlurRegion[] = [];
      for (const overlay of ordered) {
        const material = materials.get(overlay.element);
        if (!material || layerOrder.indexOf(overlay.layer) <= index) continue;
        const { left, top, width, height, right, bottom } = overlay.rect;
        if (right <= rect.left || left >= rect.right || bottom <= rect.top || top >= rect.bottom)
          continue;
        regions.push({
          x: left - rect.left,
          y: top - rect.top,
          width,
          height,
          radius: Number.parseFloat(overlay.style.borderTopLeftRadius) || 0,
          blur: material.blur,
          opacity: overlayOpacity(overlay.style),
        });
      }
      if (!regions.length) continue;
      activeLayers.add(layer);
      let entry = layers.get(layer);
      if (!entry) {
        const filter = svgNode('filter', {
          id: `native-overlay-blur-${nextId++}`,
          x: 0,
          y: 0,
          filterUnits: 'userSpaceOnUse',
          'color-interpolation-filters': 'sRGB',
        });
        definitions.append(filter);
        entry = { filter, original: layer.style.filter, signature: '' };
        layers.set(layer, entry);
      }
      const surface =
        layer === root
          ? root.firstElementChild
          : ordered.find((overlay) => overlay.layer === layer)?.element;
      const coversWindow =
        rect.left <= 0 && rect.top <= 0 && rect.right >= innerWidth && rect.bottom >= innerHeight;
      // Only window-wide paint has an alpha floor. Rounded portals need their
      // transparent corners and enough filter extent for blur and outer shadows.
      const alpha =
        coversWindow && surface ? backgroundAlpha(getComputedStyle(surface).backgroundColor) : 0;
      const padding =
        layer === root ? 0 : Math.ceil(Math.max(...regions.map(({ blur }) => blur)) * 3);
      const signature = JSON.stringify([rect.width, rect.height, regions, alpha, padding]);
      if (signature !== entry.signature) {
        updateBlurFilter(entry.filter, rect.width, rect.height, regions, alpha, padding);
        entry.signature = signature;
      }
      const value = `${entry.original} url("#${entry.filter.id}")`.trim();
      if (layer.style.filter !== value) layer.style.filter = value;
    }
    for (const [layer, entry] of layers) {
      if (activeLayers.has(layer)) continue;
      layer.style.filter = entry.original;
      entry.filter.remove();
      layers.delete(layer);
    }
    if (
      overlays.some((element) =>
        element.getAnimations().some((animation) => animation.playState === 'running'),
      )
    )
      schedule();
  }

  const mutationObserver = new MutationObserver((records) => {
    if (records.some(({ target }) => !definitions.contains(target))) schedule();
  });
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'data-state', 'hidden'],
  });
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('animationstart', schedule, true);
  schedule();

  return () => {
    disposed = true;
    cancelAnimationFrame(scheduled);
    mutationObserver.disconnect();
    resizeObserver.disconnect();
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', schedule, true);
    document.removeEventListener('animationstart', schedule, true);
    for (const [element, material] of materials) element.style.backdropFilter = material.backdrop;
    for (const [layer, entry] of layers) layer.style.filter = entry.original;
    definitions.remove();
  };
}
