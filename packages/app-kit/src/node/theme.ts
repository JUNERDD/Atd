import fs from 'node:fs/promises';
import path from 'node:path';
import { AppAccentColorSchema } from '@atd/agent-contracts';
import { Value } from 'typebox/value';
import {
  contrast,
  fromOklch,
  over,
  parseHex,
  quantize,
  toHex,
  toOklch,
  type Rgb,
} from './color.js';
import type { ModuleAlias } from './toolchain.js';

/**
 * The page side of an app's identity color, the `accentColor` of `atd-app.json`. The build points
 * `@atd/ui/styles.css` at a stylesheet it generates in its output directory: the real `@atd/ui`
 * stylesheet, then the accent's tokens for light (`:root`) and dark (`.dark`) appearance. Wherever
 * the app imports `@atd/ui`, the tokens land right after its defaults and before everything the
 * app's CSS declares after that import, so the app's `web/src/styles.css` can still override any of
 * them. A separate stylesheet could not take that place in the cascade: loaded before `@atd/ui` it
 * would be overridden, loaded after the app's own rules it would override them. Without an
 * accentColor nothing is generated and the page builds exactly as before.
 *
 * Tokens: `--primary` and `--primary-foreground` (what shadcn's color themes change), and, following
 * the primary, the focus `--ring` (macOS draws focus in the accent color), `--chart-1` (a chart's
 * first series) and the sidebar's primary and ring. `--accent` stays neutral: in shadcn it is the
 * subtle hover fill of menus and ghost controls, not the brand. `--chart-2`–`5` stay neutral, so
 * further series sit behind the first.
 */

/** The `@atd/ui` specifier the generated stylesheet stands in for. */
const UI_STYLES = '@atd/ui/styles.css';
/** The directory `buildApp` writes the stylesheet into, inside its output; it is removed after. */
export const THEME_DIR = '.theme';

/** `@atd/ui`'s page backgrounds (`--background`) and the light and dark text it puts on a primary. */
const APPEARANCES = {
  light: { selector: ':root', background: parseHex('#ffffff') },
  dark: { selector: '.dark', background: parseHex('#171a1f') },
} as const;
const LIGHT_TEXT = parseHex('#fafafa');
const DARK_TEXT = parseHex('#171717');

/** WCAG 2 AA minimums: text on the accent, the accent as a control against the page. */
const TEXT_CONTRAST = 4.5;
const CONTROL_CONTRAST = 3;
/** Light text stays on an accent it already reads on at the large-text level (3:1). */
const LARGE_TEXT_CONTRAST = 3;
/** The hover fill of `@atd/ui`'s Button and Badge, `bg-primary/80` over the page. */
const HOVER_ALPHA = 0.8;
/** The step of the lightness search, in OKLCH L. */
const STEP = 0.0005;

export interface AccentTokens {
  primary: string;
  foreground: string;
}

/**
 * The accent's primary and the text on it, for one appearance: the nearest lightness to the
 * accent's own (hue kept, chroma reduced only where sRGB requires) at which the primary stands
 * 3:1 against the page and the text 4.5:1 on the primary, at rest and on the hover fill.
 */
function adapt(accent: Rgb, text: Rgb, background: Rgb): Rgb {
  const { l, c, h } = toOklch(accent);
  const legible = (fill: Rgb) =>
    contrast(fill, background) >= CONTROL_CONTRAST &&
    contrast(text, fill) >= TEXT_CONTRAST &&
    contrast(text, quantize(over(fill, HOVER_ALPHA, background))) >= TEXT_CONTRAST;
  for (let step = 0; step * STEP <= 1; step++) {
    for (const lightness of step === 0 ? [l] : [l + step * STEP, l - step * STEP]) {
      if (lightness < 0 || lightness > 1) continue;
      const fill = quantize(fromOklch({ l: lightness, c, h }));
      if (legible(fill)) return fill;
    }
  }
  // Every hue reaches each band of lightness it needs, so the search always ends above.
  throw new Error(`No lightness of ${toHex(accent)} is legible on ${toHex(background)}.`);
}

/** The light and dark tokens of an accent (`#RRGGBB`); the text color is the same in both. */
export function accentTokens(accentColor: string): Record<'light' | 'dark', AccentTokens> {
  const accent = parseHex(accentColor);
  const text = contrast(LIGHT_TEXT, accent) >= LARGE_TEXT_CONTRAST ? LIGHT_TEXT : DARK_TEXT;
  const on = (background: Rgb): AccentTokens => ({
    primary: toHex(adapt(accent, text, background)),
    foreground: toHex(text),
  });
  return { light: on(APPEARANCES.light.background), dark: on(APPEARANCES.dark.background) };
}

/** The generated stylesheet: the real `@atd/ui` one (`uiStyles`, relative to it), then the tokens. */
export function accentStylesheet(accentColor: string, uiStyles: string): string {
  const tokens = accentTokens(accentColor);
  const blocks = (['light', 'dark'] as const).map((name) =>
    [
      `${APPEARANCES[name].selector} {`,
      `  --primary: ${tokens[name].primary};`,
      `  --primary-foreground: ${tokens[name].foreground};`,
      '  --ring: var(--primary);',
      '  --chart-1: var(--primary);',
      '  --sidebar-primary: var(--primary);',
      '  --sidebar-primary-foreground: var(--primary-foreground);',
      '  --sidebar-ring: var(--primary);',
      '}',
    ].join('\n'),
  );
  return [
    `/* Generated by the app build from atd-app.json accentColor ${accentColor}. */`,
    `@import ${JSON.stringify(uiStyles)};`,
    ...blocks,
    '',
  ].join('\n\n');
}

/**
 * The manifest's accentColor, or `null` when it names none. Throws a readable error when
 * `atd-app.json` is not JSON or the color is not `#RRGGBB`.
 */
export async function manifestAccentColor(appDir: string): Promise<string | null> {
  const manifest: unknown = JSON.parse(
    await fs.readFile(path.join(appDir, 'atd-app.json'), 'utf8'),
  );
  const accent: unknown =
    manifest !== null && typeof manifest === 'object'
      ? Reflect.get(manifest, 'accentColor')
      : undefined;
  if (accent === undefined) return null;
  if (!Value.Check(AppAccentColorSchema, accent))
    throw new Error('accentColor must be a color written as #RRGGBB.');
  return accent;
}

export interface PageStyles {
  /** The build's CSS aliases: the toolchain's, with `@atd/ui/styles.css` themed when needed. */
  cssAliases: ModuleAlias[];
  /** Generated files the build may load besides the app and the toolchain. */
  generated: string[];
}

/**
 * The stylesheet setup of one build. With an accent, writes the themed stand-in for
 * `@atd/ui/styles.css` into `<outDir>/.theme` and points the alias at it.
 */
export async function pageStyles(
  outDir: string,
  aliases: readonly ModuleAlias[],
  accentColor: string | null,
): Promise<PageStyles> {
  if (accentColor === null) return { cssAliases: [...aliases], generated: [] };
  const ui = aliases.find((alias) => alias.specifier === UI_STYLES);
  if (!ui) throw new Error(`The toolchain has no ${UI_STYLES} alias to theme.`);
  const file = path.join(outDir, THEME_DIR, 'ui-styles.css');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    accentStylesheet(accentColor, path.relative(path.dirname(file), ui.file)),
  );
  return {
    cssAliases: aliases.map((alias) => (alias === ui ? { specifier: UI_STYLES, file } : alias)),
    generated: [file],
  };
}
