import type { Lang } from '../../../copy.ts';
import { Stage } from '../../world/Stage.tsx';

/**
 * What the open's caret wipe reveals: `writeback`'s first frame, which the open's last frame shows
 * exactly (boundary contract v1): a bare `<Stage lang={lang} t={0} />` with its defaults (Finder
 * menu bar, glow 1, no pulses, no dim, no windows) and no camera transform. `t` is seconds relative
 * to the open's last frame (negative during the wipe, 0 on that frame), so the wallpaper's glows
 * drift continuously into the next section.
 */
export function OpenExit({ lang, t }: { lang: Lang; t: number }) {
  return <Stage lang={lang} t={t} />;
}
