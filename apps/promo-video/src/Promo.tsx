import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import type { Lang } from './copy.ts';
import { useFontsReady } from './fonts.ts';
import { SCENES } from './scenes.ts';
import { SECTIONS, toFrames } from './timeline.ts';

/**
 * The film: a shortcut opens it, the three chapters the name stands for follow, then the models and
 * the privacy promise, and the same shortcut closes it. Each section plays on its own clock from its
 * start, and every moment in it is placed by the timeline the soundtrack is scored from.
 */
export function Promo({ lang }: { lang: Lang }) {
  // Frames render in parallel tabs, each mounting only the scenes on screen, so the film's root
  // holds every frame until the faces have loaded.
  useFontsReady();
  return (
    <AbsoluteFill className="film">
      {SCENES.map(({ id, name, Scene }) => (
        <Sequence
          key={id}
          name={name}
          from={toFrames(SECTIONS[id].start)}
          durationInFrames={toFrames(SECTIONS[id].end - SECTIONS[id].start)}
        >
          <Scene lang={lang} />
        </Sequence>
      ))}
      {/* Synthesized from the same timeline by scripts/soundtrack.ts, so every cue is on its frame. */}
      <Audio src={staticFile('audio/soundtrack.wav')} />
    </AbsoluteFill>
  );
}
