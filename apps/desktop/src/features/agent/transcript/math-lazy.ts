import type { MathPlugin } from 'streamdown';

/**
 * Lazy math plugin, split like `mermaid-lazy.ts`: KaTeX, its stylesheet and its fonts load only
 * once a message holds a math delimiter, so turns without math never pay for them. Until the
 * chunk resolves, or when it fails to load, a formula reads as its TeX source.
 */

let cached: MathPlugin | null = null;
let pending: Promise<MathPlugin | null> | null = null;

/**
 * Whether `text` holds something the math parser could read as a formula: a dollar, `\(`, `\[`
 * or a `math` fence. A price matches too and only loads the chunk; the parser keeps it text.
 */
export function hasMathDelimiter(text: string): boolean {
  return /\$|\\[([]|(?:```|~~~)\s*math\b/.test(text);
}

/** The plugin once loaded, so a message mounted afterwards renders its math from the first frame. */
export function loadedMathPlugin(): MathPlugin | null {
  return cached;
}

/** Resolves the shared plugin, or `null` when the chunk cannot load. */
export function loadMathPlugin(): Promise<MathPlugin | null> {
  if (cached) return Promise.resolve(cached);
  pending ??= import('./math-plugin').then(
    (module) => {
      cached = module.mathPlugin;
      return cached;
    },
    () => null,
  );
  return pending;
}
