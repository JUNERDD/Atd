import type { ComponentType } from 'react';
import type { Lang } from '../copy.ts';
import { ChooseScene } from './scenes/choose/ChooseScene.tsx';
import { EverythingScene } from './scenes/everything/EverythingScene.tsx';
import { FinaleScene } from './scenes/finale/FinaleScene.tsx';
import { OpenScene } from './scenes/open/OpenScene.tsx';
import { WritebackScene } from './scenes/writeback/WritebackScene.tsx';
import { YoursScene } from './scenes/yours/YoursScene.tsx';
import type { ReleaseSectionId } from './timeline.ts';

export interface ReleaseSceneEntry {
  id: ReleaseSectionId;
  /**
   * The name Remotion Studio shows for the section's sequence and its composition id, unique across
   * the whole Root (the launch film already uses Open, Yours, Finale…).
   */
  name: string;
  Scene: ComponentType<{ lang: Lang }>;
}

/** Each section's scene, in film order; the release timeline places them. */
export const RELEASE_SCENES: readonly ReleaseSceneEntry[] = [
  { id: 'open', name: 'R08Open', Scene: OpenScene },
  { id: 'writeback', name: 'R08Writeback', Scene: WritebackScene },
  { id: 'choose', name: 'R08Choose', Scene: ChooseScene },
  { id: 'yours', name: 'R08Yours', Scene: YoursScene },
  { id: 'everything', name: 'R08Everything', Scene: EverythingScene },
  { id: 'finale', name: 'R08Finale', Scene: FinaleScene },
];
