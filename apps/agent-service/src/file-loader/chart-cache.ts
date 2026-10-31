import { SSF } from 'xlsx';
import { childElements, descendants, ownText, type XmlElement } from './xml.js';

/** Points retained per series; callers report how many remain. */
export const MAX_POINTS = 500;

/** A cache's retained points and its declared or observed length. */
export interface Points {
  values: string[];
  total: number;
}

export const NO_POINTS: Points = { values: [], total: 0 };

interface DateFormats {
  is_date(format: string): boolean;
  format(format: string, value: number, options: { date1904: boolean }): string;
}

/** SheetJS exposes SSF without types; check the formatter at the module boundary. */
function isDateFormats(value: unknown): value is DateFormats {
  return (
    typeof value === 'object' &&
    value !== null &&
    'is_date' in value &&
    typeof value.is_date === 'function' &&
    'format' in value &&
    typeof value.format === 'function'
  );
}

const formats: unknown = SSF;
if (!isDateFormats(formats)) throw new Error('SheetJS date formatter did not load.');
const dateFormats = formats;

/** The first cached level of a reference, including string and numeric literals. */
export function cachedPoints(reference: XmlElement | undefined, date1904 = false): Points {
  return cachedLevels(reference, date1904).at(-1) ?? NO_POINTS;
}

/** Category levels, outermost first; sparse parent labels extend to the next label. */
export function cachedLevels(reference: XmlElement | undefined, date1904 = false): Points[] {
  if (!reference) return [];
  const cache = ['strCache', 'numCache', 'multiLvlStrCache', 'strLit', 'numLit']
    .map((name) => descendants(reference, name)[0])
    .find((found) => found !== undefined);
  if (!cache) return [];
  const text = (pt: XmlElement) => ownText(childElements(pt, 'v')[0] ?? pt);
  if (cache.localName === 'multiLvlStrCache')
    return childElements(cache, 'lvl')
      .map((level, index) => pointsOf(cache, level, text, index > 0))
      .reverse();
  const format = childElements(cache, 'formatCode')[0];
  const numeric = cache.localName.startsWith('num');
  return [
    pointsOf(cache, cache, (pt) =>
      numeric ? numericText(text(pt), format ? ownText(format) : '', date1904) : text(pt),
    ),
  ];
}

/** Chartex categories and numeric dimensions also store levels innermost first. */
export function dimensionLevels(data: XmlElement, type: string): Points[] {
  const dim = childElements(data).find(
    (item) => /^(str|num)Dim$/.test(item.localName) && item.getAttribute('type') === type,
  );
  if (!dim) return [];
  return childElements(dim, 'lvl')
    .map((level, index) =>
      pointsOf(
        level,
        level,
        (pt) =>
          dim.localName === 'numDim'
            ? numericText(ownText(pt), level.getAttribute('formatCode') ?? '', false)
            : ownText(pt),
        type === 'cat' && index > 0,
      ),
    )
    .reverse();
}

/** Missing points remain blank, except inherited parent labels in a hierarchy. */
function pointsOf(
  counted: XmlElement,
  holder: XmlElement,
  text: (pt: XmlElement) => string,
  inherit = false,
): Points {
  const declared = Number(
    childElements(counted, 'ptCount')[0]?.getAttribute('val') ?? counted.getAttribute('ptCount'),
  );
  const valuesByIndex = new Map<number, string>();
  let reached = 0;
  for (const point of childElements(holder, 'pt')) {
    const index = Number(point.getAttribute('idx'));
    if (!Number.isSafeInteger(index) || index < 0) continue;
    reached = Math.max(reached, index + 1);
    if (index < MAX_POINTS) valuesByIndex.set(index, oneLine(text(point)));
  }
  const total = Math.max(Number.isSafeInteger(declared) && declared > 0 ? declared : 0, reached);
  let previous = '';
  const values = Array.from({ length: Math.min(total, MAX_POINTS) }, (_, index) => {
    const value = valuesByIndex.get(index);
    if (value !== undefined) previous = value;
    return value ?? (inherit ? previous : '');
  });
  return { values, total };
}

function numericText(text: string, format: string, date1904: boolean): string {
  const number = Number(text);
  if (!text.trim() || !Number.isFinite(number)) return text;
  if (format && dateFormats.is_date(format)) {
    try {
      const date = dateFormats.format(format, number, { date1904 });
      if (date) return date;
    } catch {
      // A malformed document format must not hide its cached numeric value.
    }
  }
  return String(Number(number.toPrecision(15)));
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
