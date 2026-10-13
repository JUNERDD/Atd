import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import type { Lang } from '../copy.ts';
import { useFontsReady } from '../fonts.ts';
import { RELEASE_SCENES } from './scenes.ts';
import { RELEASE_SECTIONS, toFrames } from './timeline.ts';
import './world/release.css';

/**
 * The Atd 0.8 release film: the caret's hook and the title drop, an answer written back where it
 * was asked, how a run is chosen and where it goes, what makes it yours, everything Atd already
 * does, and the sign-off. Each section plays on its own clock from its bar line.
 */
export function ReleaseFilm({ lang }: { lang: Lang }) {
  // Frames render in parallel tabs, each mounting only the scenes on screen, so the film's root
  // holds every frame until the faces have loaded.
  useFontsReady();
  return (
    <AbsoluteFill className="film r08">
      {RELEASE_SCENES.map(({ id, name, Scene }) => (
        <Sequence
          key={id}
          name={name}
          from={toFrames(RELEASE_SECTIONS[id].start)}
          durationInFrames={toFrames(RELEASE_SECTIONS[id].end - RELEASE_SECTIONS[id].start)}
        >
          <Scene lang={lang} />
        </Sequence>
      ))}
      {/* Synthesized from the same clock by scripts/soundtrack.ts, so every cue is on its frame;
          each language has its own track because the typing on screen differs. */}
      <Audio src={staticFile(`audio/release-${lang}.wav`)} />
    </AbsoluteFill>
  );
}
