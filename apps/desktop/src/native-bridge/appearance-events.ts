import { Type } from 'typebox';

/** The system appearance facts the shell reports to every page, on load and on each change. */
export const NativeAppearanceEvents = {
  /**
   * The system's Reduce transparency setting, on load and whenever it changes. WebKit has no
   * `prefers-reduced-transparency`, so glass turns opaque through this instead.
   */
  'accessibility.reduceTransparency': Type.Object(
    { reduce: Type.Boolean() },
    { additionalProperties: false },
  ),
  /**
   * What the panel background setting derives from beyond the setting itself, replayed when a page
   * becomes ready: the system accent color as sRGB `#rrggbb` (`NSColor.controlAccentColor`), which
   * the `accent` tint takes its hue from, sent again whenever the user changes it; and whether the
   * windows stand on Liquid Glass (macOS 26), the only material whose variant, blur and refraction
   * the setting can change.
   */
  'appearance.system': Type.Object(
    {
      accentColor: Type.String({ pattern: '^#[0-9a-f]{6}$' }),
      liquidGlass: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
};
