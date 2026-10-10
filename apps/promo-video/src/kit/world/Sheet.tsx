import { AbsoluteFill, Sequence } from 'remotion';
import { useFontsReady } from '../../fonts.ts';
import { toFrames } from '../../timeline.ts';
import { DesktopPage } from './sheet/DesktopPage.tsx';
import { OpenPage } from './sheet/OpenPage.tsx';
import { TitlePage } from './sheet/TitlePage.tsx';

/** The sheet's pages, in seconds: each proves a group of the kit in motion. */
const PAGES = [
  { name: 'Title and caption', from: 0, to: 1.8, Page: TitlePage },
  { name: 'Keycaps and mark', from: 1.8, to: 4.6, Page: OpenPage },
  { name: 'Desktop, camera, cursor', from: 4.6, to: 8, Page: DesktopPage },
] as const;

/**
 * The world kit's review sheet (composition `WorldSheet`, 8 s): every component animating, so
 * stills at any frame prove them. 0–1.8 s: a chapter title flying through, captions in both
 * languages. 1.8–4.6 s: macro keycaps pressed, the mark forming, settling and locking up with the
 * wordmark. 4.6–8 s: the Mac desktop through a time-lapse sky, a Finder drag into a bouncing
 * folder, the status item's states, hint keycaps, and the camera zooming 3× and whipping.
 */
export function WorldSheet() {
  useFontsReady();
  return (
    <AbsoluteFill className="scene">
      {PAGES.map(({ name, from, to, Page }) => (
        <Sequence
          key={name}
          name={name}
          from={toFrames(from)}
          durationInFrames={toFrames(to - from)}
        >
          <Page />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
