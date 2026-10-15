import remarkMath from '@ziloen/remark-math';
import rehypeKatex from 'rehype-katex';
import type { MathPlugin } from 'streamdown';
import 'katex/dist/katex.min.css';
// A native copy of rendered math puts each formula's TeX on the clipboard, not its glyphs.
import 'katex/contrib/copy-tex';
import { DISPLAY_MATH_TAG } from './math-lazy';

/** The slice of a hast node the display wrap reads and rewrites. */
type HastNode = {
  type: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

const isDisplay = (node: HastNode) =>
  node.type === 'element' &&
  Array.isArray(node.properties?.className) &&
  node.properties.className.includes('katex-display');

/** Wraps each display formula under `node` in `DISPLAY_MATH_TAG`. */
function wrapDisplays(node: HastNode) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (isDisplay(child)) {
      return { type: 'element', tagName: DISPLAY_MATH_TAG, properties: {}, children: [child] };
    }
    wrapDisplays(child);
    return child;
  });
}

/**
 * KaTeX, then a wrap around each display formula: a long equation scrolls sideways in the shared
 * ScrollArea the wrap renders as, so its bar matches the transcript's instead of WebKit's own.
 */
function rehypeKatexDisplays(options: Parameters<typeof rehypeKatex>[0]) {
  const render = rehypeKatex(options);
  return (...args: Parameters<typeof render>) => {
    render(...args);
    wrapDisplays(args[0]);
  };
}

/**
 * Math in messages, the chunk `math-lazy.ts` loads on demand. Streamdown's `@streamdown/math`
 * (remark-math) reads only dollars, so the `\(…\)` and `\[…\]` many models write would stay text.
 * `@ziloen/remark-math` reads all four delimiters into the same math nodes, and a single dollar
 * delimits math only away from ASCII letters and digits (VS Code's rule): prices (`$5 and $10`)
 * and shell variables stay text, while `函数$f(x)$的` is a formula. `$$…$$` on a line of its own
 * displays; inside a sentence it stays inline. KaTeX runs after Streamdown's sanitize and harden
 * passes with `trust` off, so TeX cannot add links, classes or styles of its own.
 */
export const mathPlugin: MathPlugin = {
  name: 'katex',
  type: 'math',
  remarkPlugin: remarkMath,
  rehypePlugin: [
    rehypeKatexDisplays,
    {
      // A formula KaTeX cannot parse shows as its source in the muted text color, the token
      // itself rather than Tailwind's root alias, so a surface that retints it is followed.
      errorColor: 'var(--muted-foreground)',
      // Models put Unicode (CJK, dashes) in math mode; KaTeX renders it either way, and `warn`
      // would log every such character on every streamed render.
      strict: 'ignore',
    },
  ],
};
