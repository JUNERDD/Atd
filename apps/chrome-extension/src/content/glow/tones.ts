import {
  GLOW_PALETTES,
  type GlowAppearance,
  type GlowRgb,
  type GlowTones,
} from '@atd/ui/lib/glow/palettes';

/**
 * The light's colour and strength over a page. Palettes are the shared `GLOW_PALETTES` (working,
 * attention) plus the tab's own `frozen` one; the levels, band and the dark-page profile are the
 * prototype's (`glow.js`), which tuned them across a whole tab edge rather than the HUD capsule
 * the shell's `GLOW_EMPHASIS` and `GLOW_STRENGTH` were made for.
 */

/**
 * A disconnected tab: the field stops and drains to neutral, so it never reads as live (the
 * prototype's proposal; the shell has no such palette).
 */
const FROZEN: Record<GlowAppearance, GlowTones> = {
  light: [
    [0.62, 0.64, 0.66],
    [0.74, 0.75, 0.77],
    [0.96, 0.96, 0.97],
  ],
  dark: [
    [0.12, 0.13, 0.14],
    [0.36, 0.37, 0.39],
    [0.62, 0.63, 0.65],
  ],
};

/** The band's depth into the tab on a light page, in CSS px. */
const BAND = 72;

/**
 * On dark pages the light drawn over the page turns muddy (orange over near-black is brown) and a
 * lower level only darkens the brown. The emissive profile adds the light to the page instead
 * (`plus-lighter` on its layer), hugs the edge and takes some chroma out, so it reads as light,
 * not paint.
 */
const EMISSIVE = { level: 0.85, band: 0.75, chroma: 0.95 } as const;
const LIGHT_PAGE_LEVEL = 0.5;

/** How far each palette is blended in (eased by the light, never switched). */
export interface ToneMix {
  attention: number;
  frozen: number;
}

/**
 * How dark the page is under the band, from its sampled background luminance (not the system
 * appearance: sites keep their own): 0 on a light page, 1 on a dark one, mid-grey in between.
 */
export function pageDarkness(luminance: number): number {
  const t = Math.min(1, Math.max(0, (luminance - 0.12) / (0.35 - 0.12)));
  return 1 - t * t * (3 - 2 * t);
}

/** Whether the light is added to the page rather than drawn over it. */
export function isAdditive(darkness: number): boolean {
  return darkness > 0.5;
}

const toward = (light: number, dark: number, darkness: number) => light + (dark - light) * darkness;

function mix(a: GlowRgb, b: GlowRgb, amount: number): GlowRgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function byPage(palette: Record<GlowAppearance, GlowTones>, darkness: number): GlowTones {
  return [
    mix(palette.light[0], palette.dark[0], darkness),
    mix(palette.light[1], palette.dark[1], darkness),
    mix(palette.light[2], palette.dark[2], darkness),
  ];
}

/** The tones the field interpolates for this page and blend. */
export function tonesFor(darkness: number, blend: ToneMix): GlowTones {
  const working = byPage(GLOW_PALETTES.working, darkness);
  const attention = byPage(GLOW_PALETTES.attention, darkness);
  const frozen = byPage(FROZEN, darkness);
  const chroma = toward(1, EMISSIVE.chroma, darkness);
  const tone = (index: 0 | 1 | 2): GlowRgb => {
    const color = mix(
      mix(working[index], attention[index], blend.attention),
      frozen[index],
      blend.frozen,
    );
    const luma = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
    return [
      luma + (color[0] - luma) * chroma,
      luma + (color[1] - luma) * chroma,
      luma + (color[2] - luma) * chroma,
    ];
  };
  return [tone(0), tone(1), tone(2)];
}

/**
 * The light's strength, drawn in the shader (a CSS opacity would scale its dither and band it).
 * Across a whole tab edge warm tones carry far more weight than the working light, so attention is
 * drawn lighter, not stronger; a frozen light dims too.
 */
export function levelFor(darkness: number, blend: ToneMix): number {
  const attention = 1 - toward(0.32, 0.1, darkness) * blend.attention;
  const base = toward(LIGHT_PAGE_LEVEL, EMISSIVE.level, darkness);
  return Math.min(1, base * attention * (1 - 0.45 * blend.frozen));
}

/** The band's depth for this page, in CSS px. */
export function bandFor(darkness: number): number {
  return BAND * toward(1, EMISSIVE.band, darkness);
}
