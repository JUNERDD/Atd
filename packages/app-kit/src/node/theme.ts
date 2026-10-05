import fs from 'node:fs/promises';
import path from 'node:path';
import { AppAccentColorSchema, AppSurfaceSchema, type AppSurface } from '@atd/agent-contracts';
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
 * The page side of an app's look in `atd-app.json`: its identity color (`accentColor`) and its
 * window surface (`window.surface`). The build points `@atd/ui/styles.css` at a stylesheet it
 * generates in its output directory: the real `@atd/ui` stylesheet, then the rules the manifest
 * asks for. Wherever the app imports `@atd/ui`, those rules land right after its defaults and
 * before everything the app's CSS declares after that import, so the app's `web/src/styles.css`
 * can still override any of them. A separate stylesheet could not take that place in the cascade:
 * loaded before `@atd/ui` it would be overridden, loaded after the app's own rules it would
 * override them. Without an accentColor and a glass surface nothing is generated and the page
 * builds exactly as before.
 *
 * Accent tokens: `--primary` and `--primary-foreground` (what shadcn's color themes change), and,
 * following the primary, the focus `--ring` (macOS draws focus in the accent color), `--chart-1`
 * (a chart's first series) and the sidebar's primary and ring, for light (`:root`) and dark
 * (`.dark`) appearance. `--accent` stays neutral: in shadcn it is the subtle hover fill of menus and
 * ghost controls, not the brand. `--chart-2`–`5` stay neutral, so further series sit behind the
 * first.
 *
 * Glass surface: the shell builds a `glass` app's window as Atd's settings window (glass material,
 * a transparent web view and the 52 pt unified title bar), and the page paints the task panel's
 * fill and lays its first row out on that title bar (`GLASS_RULES`).
 */

/** The `@atd/ui` specifier the generated stylesheet stands in for. */
const UI_STYLES = '@atd/ui/styles.css';
/** The directory `buildApp` writes the stylesheet into, inside its output; it is removed after. */
export const THEME_DIR = '.theme';

/**
 * Where a primary sits: the background it must stand 3:1 against, and every background its hover
 * fill can lie over, on each of which the text must still read 4.5:1.
 */
interface Page {
  background: Rgb;
  hoverOver: readonly Rgb[];
}

/** An opaque page of one color. */
const opaque = (background: Rgb): Page => ({ background, hoverOver: [background] });

/** `@atd/ui`'s page backgrounds (`--background`) and the light and dark text it puts on a primary. */
const APPEARANCES = {
  light: { selector: ':root', page: opaque(parseHex('#ffffff')) },
  dark: { selector: '.dark', page: opaque(parseHex('#171a1f')) },
} as const;
/** The panel fill over glass that shows `desktop` (`--ata-surface-panel` in `@atd/ui`). */
const panelOver = (desktop: string) => quantize(over(parseHex('#181818'), 0.8, parseHex(desktop)));
/**
 * A glass window's dark page, which is not `--background`: the panel fill over whatever desktop
 * the glass shows, from #464646 over a white one to #131313 over a black one. A primary that
 * stands 3:1 against the lightest stands out over any desktop, and its text has to read on the
 * hover fill over both.
 */
const GLASS_PAGE: Page = {
  background: panelOver('#ffffff'),
  hoverOver: [panelOver('#ffffff'), panelOver('#000000')],
};
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

/**
 * A glass window's page (`window.surface: "glass"`). `#root` paints the task panel's one fill,
 * `--ata-surface-panel`: translucent over the window's glass, opaque under Reduce transparency
 * (`data-reduced-transparency`, which the shell writes). Not `html` or `body`: WebKit propagates
 * their background to the canvas, where it paints a translucent color twice over the transparent
 * web view, and a background an app gives them only shows through this fill. `.atd-titlebar` is
 * the page's first row on the native title bar, as the renderer's panel header: 52 px high, with
 * 88 px of leading inset that clear the traffic lights. Both rules sit in cascade layers, so an
 * app's own unlayered rule replaces them whatever its specificity.
 */
const GLASS_RULES = `@layer base {
  #root {
    min-height: 100dvh;
    background-color: var(--ata-surface-panel);
  }
  body {
    -webkit-font-smoothing: antialiased;
  }
}

:root {
  --ata-titlebar-height: 52px;
  --ata-titlebar-inset: 88px;
}

@layer components {
  .atd-titlebar {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 8px;
    height: var(--ata-titlebar-height);
    padding-inline: var(--ata-titlebar-inset) 12px;
    user-select: none;
  }
}`;

export interface AccentTokens {
  primary: string;
  foreground: string;
}

/**
 * The accent's primary for one appearance with `text` on it: the nearest lightness to the
 * accent's own (hue kept, chroma reduced only where sRGB requires) at which the primary stands
 * 3:1 against the page and the text 4.5:1 on the primary, at rest and on the hover fill over every
 * background the page shows. Null when no lightness satisfies all of them.
 */
function adapt(accent: Rgb, text: Rgb, page: Page): Rgb | null {
  const { l, c, h } = toOklch(accent);
  const legible = (fill: Rgb) =>
    contrast(fill, page.background) >= CONTROL_CONTRAST &&
    contrast(text, fill) >= TEXT_CONTRAST &&
    page.hoverOver.every(
      (under) => contrast(text, quantize(over(fill, HOVER_ALPHA, under))) >= TEXT_CONTRAST,
    );
  for (let step = 0; step * STEP <= 1; step++) {
    for (const lightness of step === 0 ? [l] : [l + step * STEP, l - step * STEP]) {
      if (lightness < 0 || lightness > 1) continue;
      const fill = quantize(fromOklch({ l: lightness, c, h }));
      if (legible(fill)) return fill;
    }
  }
  return null;
}

/** `adapt` with the text it must carry; every hue reaches each band of lightness it needs. */
function tokens(accent: Rgb, text: Rgb, page: Page): AccentTokens {
  const fill = adapt(accent, text, page);
  if (!fill)
    throw new Error(`No lightness of ${toHex(accent)} is legible on ${toHex(page.background)}.`);
  return { primary: toHex(fill), foreground: toHex(text) };
}

/**
 * The light and dark tokens of an accent (`#RRGGBB`). The text color is chosen once, from the
 * accent itself, and is the same in both, except on a glass window's dark page: there it is the
 * light text when some lightness carries it, otherwise the dark one, since that page can be as
 * light as #464646, where a fill bright enough to stand out takes dark text.
 */
export function accentTokens(
  accentColor: string,
  surface: AppSurface,
): Record<'light' | 'dark', AccentTokens> {
  const accent = parseHex(accentColor);
  const text = contrast(LIGHT_TEXT, accent) >= LARGE_TEXT_CONTRAST ? LIGHT_TEXT : DARK_TEXT;
  const light = tokens(accent, text, APPEARANCES.light.page);
  if (surface !== 'glass') return { light, dark: tokens(accent, text, APPEARANCES.dark.page) };
  const lightText = adapt(accent, LIGHT_TEXT, GLASS_PAGE);
  const dark = lightText
    ? { primary: toHex(lightText), foreground: toHex(LIGHT_TEXT) }
    : tokens(accent, DARK_TEXT, GLASS_PAGE);
  return { light, dark };
}

export interface PageTheme {
  accentColor: string | null;
  surface: AppSurface;
}

/** The generated stylesheet: the real `@atd/ui` one (`uiStyles`, relative to it), then the rules. */
export function pageStylesheet({ accentColor, surface }: PageTheme, uiStyles: string): string {
  const glass = surface === 'glass';
  const sources = [
    ...(glass ? ['window.surface glass'] : []),
    ...(accentColor === null ? [] : [`accentColor ${accentColor}`]),
  ];
  const accent = accentColor === null ? null : accentTokens(accentColor, surface);
  const blocks = accent
    ? (['light', 'dark'] as const).map((name) =>
        [
          `${APPEARANCES[name].selector} {`,
          `  --primary: ${accent[name].primary};`,
          `  --primary-foreground: ${accent[name].foreground};`,
          '  --ring: var(--primary);',
          '  --chart-1: var(--primary);',
          '  --sidebar-primary: var(--primary);',
          '  --sidebar-primary-foreground: var(--primary-foreground);',
          '  --sidebar-ring: var(--primary);',
          '}',
        ].join('\n'),
      )
    : [];
  return [
    `/* Generated by the app build from atd-app.json ${sources.join(' and ')}. */`,
    `@import ${JSON.stringify(uiStyles)};`,
    ...(glass ? [GLASS_RULES] : []),
    ...blocks,
    '',
  ].join('\n\n');
}

/** `atd-app.json` of the app in `appDir`, parsed; the build checks only the fields it reads. */
async function readManifest(appDir: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(appDir, 'atd-app.json'), 'utf8'));
}

const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined;

/**
 * The manifest's accentColor, or `null` when it names none. Throws a readable error when
 * `atd-app.json` is not JSON or the color is not `#RRGGBB`.
 */
export async function manifestAccentColor(appDir: string): Promise<string | null> {
  const accent = field(await readManifest(appDir), 'accentColor');
  if (accent === undefined) return null;
  if (!Value.Check(AppAccentColorSchema, accent))
    throw new Error('accentColor must be a color written as #RRGGBB.');
  return accent;
}

/**
 * The manifest's `window.surface`, `opaque` when it names none (the apps made before surfaces
 * existed). Throws a readable error when `atd-app.json` is not JSON or the surface is not one of
 * `glass` and `opaque`.
 */
export async function manifestSurface(appDir: string): Promise<AppSurface> {
  const surface = field(field(await readManifest(appDir), 'window'), 'surface');
  if (surface === undefined) return 'opaque';
  if (!Value.Check(AppSurfaceSchema, surface))
    throw new Error('window.surface must be "glass" or "opaque".');
  return surface;
}

export interface PageStyles {
  /** The build's CSS aliases: the toolchain's, with `@atd/ui/styles.css` themed when needed. */
  cssAliases: ModuleAlias[];
  /** Generated files the build may load besides the app and the toolchain. */
  generated: string[];
}

/**
 * The stylesheet setup of one build. With an accent or a glass surface, writes the stand-in for
 * `@atd/ui/styles.css` into `<outDir>/.theme` and points the alias at it.
 */
export async function pageStyles(
  outDir: string,
  aliases: readonly ModuleAlias[],
  accentColor: string | null,
  surface: AppSurface,
): Promise<PageStyles> {
  if (accentColor === null && surface !== 'glass')
    return { cssAliases: [...aliases], generated: [] };
  const ui = aliases.find((alias) => alias.specifier === UI_STYLES);
  if (!ui) throw new Error(`The toolchain has no ${UI_STYLES} alias to theme.`);
  const file = path.join(outDir, THEME_DIR, 'ui-styles.css');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    pageStylesheet({ accentColor, surface }, path.relative(path.dirname(file), ui.file)),
  );
  return {
    cssAliases: aliases.map((alias) => (alias === ui ? { specifier: UI_STYLES, file } : alias)),
    generated: [file],
  };
}
