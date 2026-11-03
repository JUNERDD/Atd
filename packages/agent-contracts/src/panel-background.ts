import { Type, type Static } from 'typebox';

/**
 * The panel background setting: the fill the task panel, the Settings window and the shell's
 * floating surfaces (selection toolbar, mini panel, command HUD) paint over their Liquid Glass,
 * and the glass parameters under it. The defaults are a recipe measured on the composited screen
 * over eight backdrops: the lightest fill that keeps secondary text at 4.5:1 everywhere. The
 * ranges reach past that, since a user who finds the panel too heavy or too faint adjusts it, but
 * stop where it would be unusable; the renderer derives every surface from the setting
 * (`apps/desktop/src/theme/panel-background/`).
 */

/** Hues the fill can take at the tone's lightness; `accent` follows the system accent color. */
export const PANEL_TINTS = [
  'neutral',
  'graphite',
  'blue',
  'purple',
  'green',
  'sand',
  'rose',
  'accent',
] as const;
/** Kept literal so the static type stays a union; update it together with `PANEL_TINTS`. */
export type PanelTint = (typeof PANEL_TINTS)[number];

export const PanelTintSchema = Type.Union([
  Type.Literal('neutral'),
  Type.Literal('graphite'),
  Type.Literal('blue'),
  Type.Literal('purple'),
  Type.Literal('green'),
  Type.Literal('sand'),
  Type.Literal('rose'),
  Type.Literal('accent'),
]);

/** `NSGlassEffectView.Style` of the panel's and floating surfaces' Liquid Glass. */
export const PANEL_GLASS_VARIANTS = ['regular', 'clear'] as const;
/** Kept literal so the static type stays a union; update it with `PANEL_GLASS_VARIANTS`. */
export type PanelGlassVariant = (typeof PANEL_GLASS_VARIANTS)[number];
export const PanelGlassVariantSchema = Type.Union([Type.Literal('regular'), Type.Literal('clear')]);

/**
 * The fill's gray level per appearance: as far as a solid panel keeps secondary text at 4.5:1
 * (#b4b4b4 over #404040 is 5.0:1, #636363 over #e0e0e0 4.5:1).
 */
export const PANEL_TONE_RANGE = { dark: [0, 64], light: [224, 255] } as const;

/**
 * The Liquid Glass parameters relative to the system's own (1 leaves them). Refraction is a
 * multiple of the system's, up to twice. Blur is a strength: down to half the system's radius, so
 * the desktop behind never reads sharply under text, and above 1 rising to a radius that conceals
 * text behind the glass at 2, since the system's own radius varies tenfold with the variant and
 * whether the window is key (`GlassTuner` in the shell).
 */
export const PANEL_GLASS_TUNING_RANGE = {
  blur: [0.5, 2],
  refractionWidth: [0, 2],
  refractionStrength: [0, 2],
} as const;

const tone = (theme: keyof typeof PANEL_TONE_RANGE) =>
  Type.Integer({ minimum: PANEL_TONE_RANGE[theme][0], maximum: PANEL_TONE_RANGE[theme][1] });
const tuning = (key: keyof typeof PANEL_GLASS_TUNING_RANGE) =>
  Type.Number({
    minimum: PANEL_GLASS_TUNING_RANGE[key][0],
    maximum: PANEL_GLASS_TUNING_RANGE[key][1],
  });
const Opacity = Type.Integer({ minimum: 0, maximum: 100 });

export const PanelBackgroundSchema = Type.Object(
  {
    /**
     * The fill's opacity in percent per appearance, as chosen (100 is solid). The panel shows at
     * least the most transparent fill that keeps secondary text at 3:1 for the tone and variant,
     * which the renderer derives, so a stored value below that reads as that limit.
     */
    opacity: Type.Object({ dark: Opacity, light: Opacity }, { additionalProperties: false }),
    /** The fill's sRGB gray level per appearance, before the tint (`PANEL_TONE_RANGE`). */
    tone: Type.Object(
      { dark: tone('dark'), light: tone('light') },
      { additionalProperties: false },
    ),
    tint: PanelTintSchema,
    glass: PanelGlassVariantSchema,
    /** How much the desktop behind is blurred, as a strength (`PANEL_GLASS_TUNING_RANGE`). */
    blur: tuning('blur'),
    /** How wide the refracting band along the edge is, times the system's. */
    refractionWidth: tuning('refractionWidth'),
    /** How far that band bends what is behind, times the system's; 0 turns it off. */
    refractionStrength: tuning('refractionStrength'),
  },
  { additionalProperties: false },
);
export type PanelBackground = Static<typeof PanelBackgroundSchema>;

/** The measured recipe: dark `rgb(24 24 24 / 60%)`, light `rgb(255 255 255 / 56%)`, system glass. */
export const DEFAULT_PANEL_BACKGROUND: PanelBackground = {
  opacity: { dark: 60, light: 56 },
  tone: { dark: 24, light: 255 },
  tint: 'neutral',
  glass: 'regular',
  blur: 1,
  refractionWidth: 1,
  refractionStrength: 1,
};
