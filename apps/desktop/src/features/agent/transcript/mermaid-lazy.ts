import type { DiagramPlugin, MermaidConfig } from '@streamdown/mermaid';
import type { ColorScheme } from '../../../theme/color-scheme';

/**
 * Lazy mermaid plugin (plan T5). `@streamdown/mermaid` statically imports the mermaid engine, so a
 * static import would drag it into the transcript boot chunk for a fence type most turns never
 * contain. This keeps the same `DiagramPlugin` shape but dynamic-imports the wrapper on first use,
 * which lets Vite split the engine into its own chunk. A direct `import 'mermaid'` is impossible
 * here — mermaid is only a transitive dependency — so the wrapper module is the split point.
 */

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'strict',
  fontFamily: 'monospace',
  suppressErrorRendering: true,
};

/**
 * The mermaid theme drawn for a color scheme: `neutral` is made for light backgrounds, `dark` for
 * dark ones. Streamdown hands this config to the plugin on every render (`MermaidOptions.config`)
 * and the plugin re-initialises mermaid with it, so a scheme change redraws open diagrams. The
 * plugin itself stays scheme-free (its own config is the light one), which is also what exports
 * draw with: a saved diagram is read outside the app, on white.
 */
export function mermaidConfig(scheme: ColorScheme): MermaidConfig {
  return { theme: scheme === 'dark' ? 'dark' : 'neutral' };
}

let cached: DiagramPlugin | null = null;
let pending: Promise<DiagramPlugin | null> | null = null;

export function hasMermaidFence(text: string): boolean {
  return /```mermaid(?:\s|$)/i.test(text);
}

/** Resolves the shared plugin, or `null` when the chunk cannot load — fences degrade to code. */
export function loadMermaidPlugin(): Promise<DiagramPlugin | null> {
  if (cached) return Promise.resolve(cached);
  pending ??= import('@streamdown/mermaid').then(
    (module) => {
      cached = module.createMermaidPlugin({ config: MERMAID_CONFIG });
      return cached;
    },
    () => null,
  );
  return pending;
}
