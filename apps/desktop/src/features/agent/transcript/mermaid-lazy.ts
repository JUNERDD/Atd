import type { DiagramPlugin, MermaidConfig } from '@streamdown/mermaid';

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
