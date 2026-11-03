import { DEFAULT_THEMES, registerCustomTheme, resolveTheme, type DiffsTheme } from '@pierre/diffs';
import { CODE_PALETTE, type Theme } from '../../../theme/panel-background/measured';

/**
 * The code theme of every `@pierre/diffs` body (`CodeFile`, `StreamingCodeBlock`, `DiffView`, and
 * the worker pool's highlighter): pierre's own `pierre-dark` and `pierre-light` with the syntax
 * colors the translucent code well needs (`CODE_PALETTE`), each moved in lightness only. The swap
 * is Shiki's theme-level `colorReplacements`, which recolors a token as it is tokenized on either
 * thread, so the colors reach the shadow root through pierre's own inline token styles. The well
 * thickens to opaque with the panel, where the swapped colors still read at least as well as
 * pierre's, so the theme stays the same for every panel background.
 */
export const CODE_THEMES = { dark: 'atd-panel-dark', light: 'atd-panel-light' } as const;

async function panelCodeTheme(theme: Theme): Promise<DiffsTheme> {
  const base = await resolveTheme(DEFAULT_THEMES[theme]);
  // Shiki, the highlighter the app runs, highlights from the TextMate form.
  if (!base.textmate) throw new Error(`${base.name} has no TextMate theme.`);
  // Shiki looks replacements up by the token color in lower case.
  const swaps = Object.fromEntries(
    Object.entries(CODE_PALETTE[theme]).map(([from, to]) => [from.toLowerCase(), to]),
  );
  const name = CODE_THEMES[theme];
  return {
    ...base,
    name,
    textmate: {
      ...base.textmate,
      name,
      colorReplacements: { ...base.textmate.colorReplacements, ...swaps },
    },
  };
}

// Pierre resolves a registered theme on the main thread when a body or the pool first needs it,
// and hands the worker the resolved theme; registering on load keeps it ahead of every render.
for (const theme of ['dark', 'light'] as const) {
  registerCustomTheme(CODE_THEMES[theme], () => panelCodeTheme(theme), 'diffs');
}
