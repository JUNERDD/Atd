export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  blur: number;
  /** Overlay computed opacity (0..1, 2dp). Scales mask transparency during fades. */
  opacity: number;
}

export function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** Replace the covered source pixels, retaining their alpha instead of painting an opaque backplate. */
export function updateBlurFilter(
  filter: SVGFilterElement,
  width: number,
  height: number,
  regions: BlurRegion[],
  surfaceAlpha: number,
  padding: number,
) {
  filter.setAttribute('x', String(-padding));
  filter.setAttribute('y', String(-padding));
  filter.setAttribute('width', String(width + padding * 2));
  filter.setAttribute('height', String(height + padding * 2));
  const children: SVGElement[] = [];
  let source = 'SourceGraphic';
  regions.forEach((region, index) => {
    const { x, y, width, height, radius, blur, opacity } = region;
    // Opacity 1 keeps the exact pre-ramp mask bytes; fades scale mask transparency.
    const maskRect =
      opacity >= 1
        ? `<rect width="${width}" height="${height}" rx="${radius}" fill="white"/>`
        : `<rect width="${width}" height="${height}" rx="${radius}" fill="white" fill-opacity="${opacity}"/>`;
    const mask = `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${maskRect}</svg>`,
    )}`;
    children.push(
      svgNode('feGaussianBlur', {
        in: source,
        stdDeviation: blur,
        edgeMode: 'duplicate',
        result: `soft-${index}`,
      }),
    );
    // Chromium does not clamp SVG blur at a transparent window edge. Keep the
    // source surface's alpha floor so the native corners do not acquire a halo.
    const alpha = svgNode('feComponentTransfer', { in: `soft-${index}`, result: `blur-${index}` });
    alpha.append(
      svgNode('feFuncA', {
        type: 'table',
        tableValues: Array.from({ length: 101 }, (_, step) =>
          Math.max(surfaceAlpha, step / 100),
        ).join(' '),
      }),
    );
    children.push(
      alpha,
      svgNode('feImage', { href: mask, x, y, width, height, result: `mask-${index}` }),
      svgNode('feComposite', {
        in: `blur-${index}`,
        in2: `mask-${index}`,
        operator: 'in',
        result: `patch-${index}`,
      }),
      svgNode('feComposite', {
        in: source,
        in2: `mask-${index}`,
        operator: 'out',
        result: `rest-${index}`,
      }),
      svgNode('feComposite', {
        in: `patch-${index}`,
        in2: `rest-${index}`,
        operator: 'over',
        result: `surface-${index}`,
      }),
    );
    source = `surface-${index}`;
  });
  filter.replaceChildren(...children);
}
