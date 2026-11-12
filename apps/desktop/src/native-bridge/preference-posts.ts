/**
 * The app-wide preferences the panel page pushes to the shell after the service's settings load
 * and on every change. The shell applies each one itself, so its native surfaces follow them too.
 */
import { Type } from 'typebox';

/**
 * One appearance's panel fill as the renderer derived it from the panel background setting
 * (`apps/desktop/src/theme/panel-background/`): the sRGB color, which turns opaque under Reduce
 * Transparency, its opacity over Liquid Glass, and the factor for the floating surfaces' vibrant
 * field and selection washes, which lift the glass by a fixed amount while a thinner fill lets more
 * of the desktop through.
 */
const PanelFillSchema = Type.Object(
  {
    red: Type.Integer({ minimum: 0, maximum: 255 }),
    green: Type.Integer({ minimum: 0, maximum: 255 }),
    blue: Type.Integer({ minimum: 0, maximum: 255 }),
    alpha: Type.Number({ minimum: 0, maximum: 1 }),
    washScale: Type.Number({ minimum: 1, maximum: 4 }),
  },
  { additionalProperties: false },
);

export const NativePreferencePosts = {
  /** The app language (Swift uses the OS language until then). */
  'language.set': Type.Object(
    { language: Type.Union([Type.Literal('en'), Type.Literal('zh-CN')]) },
    { additionalProperties: false },
  ),
  /**
   * The appearance: `null` follows the system. Swift applies it app-wide, so the web views'
   * `prefers-color-scheme` and every native surface follow, and restores the last one at launch
   * before any window shows.
   */
  'appearance.set': Type.Object(
    {
      appearance: Type.Union([
        Type.Union([Type.Literal('light'), Type.Literal('dark')]),
        Type.Null(),
      ]),
    },
    { additionalProperties: false },
  ),
  /**
   * Whether the shell's surfaces show their working glows and shimmer running text, like the
   * page's (`glowEffects`). Swift keeps it and restores the last one at launch, showing them until
   * the first push.
   */
  'glowEffects.set': Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
  /**
   * Whether the shell's floating result cards (the command island's answer and review cards, and
   * the capture, recording and long screenshot results) render Markdown or show plain text
   * (`resultMarkdown`). Swift keeps it and restores the last one at launch, rendering Markdown
   * until the first push.
   */
  'resultMarkdown.set': Type.Object({ enabled: Type.Boolean() }, { additionalProperties: false }),
  /**
   * The panel background for the shell's own surfaces: the floating glass's fill per appearance
   * (`GlassSurface`), the Liquid Glass variant of the panel's, the Settings window's and the
   * floating surfaces' glass, and its blur and edge refraction relative to the system's, as
   * `PANEL_GLASS_TUNING_RANGE` describes (1 leaves them; macOS 15's material ignores the variant
   * and these). Swift keeps it and restores the last one at launch, using the measured recipe
   * until the first push.
   */
  'panelBackground.set': Type.Object(
    {
      dark: PanelFillSchema,
      light: PanelFillSchema,
      glass: Type.Union([Type.Literal('regular'), Type.Literal('clear')]),
      blur: Type.Number({ minimum: 0.5, maximum: 2 }),
      refractionWidth: Type.Number({ minimum: 0, maximum: 2 }),
      refractionStrength: Type.Number({ minimum: 0, maximum: 2 }),
    },
    { additionalProperties: false },
  ),
};
