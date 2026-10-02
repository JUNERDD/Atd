import type { DiagramPlugin } from 'streamdown';

/** WebKit's largest canvas area in pixels; a larger canvas draws nothing. */
const MAX_CANVAS_PIXELS = 16_777_216;

let renders = 0;

/** A diagram drawn for saving, at the size mermaid laid it out in CSS pixels. */
export interface DiagramSvg {
  svg: string;
  width: number;
  height: number;
}

/**
 * Draws `source` again with the transcript's mermaid plugin (the same engine and configuration as
 * the diagram on screen) as a standalone SVG document. Mermaid sizes its SVG to its container
 * (`width="100%"`, `max-width`); the copy states its drawn size instead, so other apps and the PNG
 * canvas open it at that size. Rejects with mermaid's message when the source does not draw.
 */
export async function diagramSvg(plugin: DiagramPlugin, source: string): Promise<DiagramSvg> {
  renders += 1;
  const { svg } = await plugin.getMermaid().render(`diagram-export-${renders}`, source);
  // Parsed as HTML, like the page does, so HTML labels need not be well-formed XML; serializing
  // the element then writes it as XML with its namespaces.
  const root = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg');
  const box = (root?.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [width = 0, height = 0] = box.slice(2);
  if (!root || !(width > 0) || !(height > 0)) throw new Error('The diagram could not be drawn.');
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.style.removeProperty('max-width');
  return { svg: new XMLSerializer().serializeToString(root), width, height };
}

/**
 * The diagram as PNG base64, drawn at the display's pixel ratio (fewer pixels when that would
 * exceed WebKit's canvas limit) on white, the background mermaid's light theme is drawn for. The
 * SVG loads from a `data:` URL, which WebKit does not count as cross-origin, so its HTML labels
 * leave the canvas readable.
 */
export async function diagramPng({ svg, width, height }: DiagramSvg): Promise<string> {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const scale = Math.min(
    Math.max(window.devicePixelRatio, 1),
    Math.sqrt(MAX_CANVAS_PIXELS / (width * height)),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The diagram could not be drawn.');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}
