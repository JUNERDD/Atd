/**
 * The app-wide preferences the panel page pushes to the shell after the service's settings load
 * and on every change. The shell applies each one itself, so its native surfaces follow them too.
 */
import { Type } from 'typebox';

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
};
