import symbolSvg from '@atd/ui/assets/brands/atd/symbol.svg?raw';

const SVG = 'http://www.w3.org/2000/svg';

/**
 * The Atd sign's geometry, read from the canonical brand asset (bundled, static): its viewBox and
 * path data. The element is built with `createElementNS` rather than parsed, so no HTML/XML parsing
 * sink is involved on pages that enforce Trusted Types.
 */
const VIEW_BOX = /viewBox="([^"]+)"/.exec(symbolSvg)?.[1] ?? '0 0 84 84';
const PATHS = [...symbolSvg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '');

/** A new copy of the sign, `size` px square, drawn in `currentColor`. */
export function atdMark(size: number): SVGSVGElement {
  const mark = document.createElementNS(SVG, 'svg');
  mark.setAttribute('class', 'mark');
  mark.setAttribute('viewBox', VIEW_BOX);
  mark.setAttribute('width', String(size));
  mark.setAttribute('height', String(size));
  mark.setAttribute('fill', 'currentColor');
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('focusable', 'false');
  for (const d of PATHS) {
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    mark.append(path);
  }
  return mark;
}
