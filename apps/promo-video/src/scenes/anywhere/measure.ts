/**
 * Text widths in points, measured with the film's faces at the size the text is set in (so Inter's
 * optical sizing matches the DOM), and cached only once the face is in. The article's lines and
 * the selection toolbar's labels are laid out from these.
 */
let context: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();

/** The advance width of `text` at `size` points and `weight`. */
export function textWidth(text: string, size: number, weight: number): number {
  const font = `${weight} ${size}px 'Inter Variable', 'Noto Sans SC Variable', sans-serif`;
  const key = `${font}|${text}`;
  const known = cache.get(key);
  if (known !== undefined) return known;
  if (typeof document === 'undefined') return Array.from(text).length * size * 0.52;
  context ??= document.createElement('canvas').getContext('2d');
  if (!context) return Array.from(text).length * size * 0.52;
  context.font = font;
  const width = context.measureText(text).width;
  if (document.fonts.check(font, text)) cache.set(key, width);
  return width;
}
