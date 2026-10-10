import type { ComponentType } from 'react';
import type { Lang } from './copy.ts';
import { Anything } from './scenes/anything/Anything.tsx';
import { Anytime } from './scenes/anytime/Anytime.tsx';
import { Anywhere } from './scenes/anywhere/Anywhere.tsx';
import { Finale } from './scenes/finale/Finale.tsx';
import { Open } from './scenes/open/Open.tsx';
import { Yours } from './scenes/yours/Yours.tsx';
import type { SectionId } from './timeline.ts';

export interface SceneEntry {
  id: SectionId;
  /** The name Remotion Studio shows for the section's sequence and composition. */
  name: string;
  Scene: ComponentType<{ lang: Lang }>;
}

/** Each section's scene, in film order; the timeline places them. */
export const SCENES: readonly SceneEntry[] = [
  { id: 'open', name: 'Open', Scene: Open },
  { id: 'anywhere', name: 'Anywhere', Scene: Anywhere },
  { id: 'anything', name: 'Anything', Scene: Anything },
  { id: 'anytime', name: 'Anytime', Scene: Anytime },
  { id: 'yours', name: 'Yours', Scene: Yours },
  { id: 'finale', name: 'Finale', Scene: Finale },
];
