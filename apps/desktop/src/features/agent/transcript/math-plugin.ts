import remarkMath from '@ziloen/remark-math';
import rehypeKatex from 'rehype-katex';
import type { MathPlugin } from 'streamdown';
import 'katex/dist/katex.min.css';
// A native copy of rendered math puts each formula's TeX on the clipboard, not its glyphs.
import 'katex/contrib/copy-tex';

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
    rehypeKatex,
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
