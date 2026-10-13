/**
 * Everything the release film shows, registered once: its narrative copy, each scene's in-interface
 * content and the world sheet's demo lines. `src/copy.ts` collects this list for the fonts, so a
 * scene adds its strings to its own `content.ts` and never touches a shared file.
 */
import type { Lang } from '../copy.ts';
import { releaseCopy } from './copy.ts';
import { content as choose } from './scenes/choose/content.ts';
import { content as everything } from './scenes/everything/content.ts';
import { content as finale } from './scenes/finale/content.ts';
import { content as open } from './scenes/open/content.ts';
import { content as writeback } from './scenes/writeback/content.ts';
import { content as yours } from './scenes/yours/content.ts';
import { content as worldSheet } from './world/sheet/content.ts';

export const RELEASE_CONTENT: readonly Record<Lang, unknown>[] = [
  releaseCopy,
  open,
  writeback,
  choose,
  yours,
  everything,
  finale,
  worldSheet,
];
