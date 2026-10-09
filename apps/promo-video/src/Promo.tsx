import { Audio } from '@remotion/media';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import type { Lang } from './copy.ts';
import { useFontsReady } from './fonts.ts';
import { Features } from './scenes/features/Features.tsx';
import { Intro } from './scenes/intro/Intro.tsx';
import { Outro } from './scenes/outro/Outro.tsx';
import { Privacy } from './scenes/privacy/Privacy.tsx';
import { Stage } from './stage/Stage.tsx';
import { FEATURES, INTRO, OUTRO, PRIVACY, STAGE, toFrames } from './timeline.ts';
import { Plate } from './ui/Plate.tsx';

/**
 * The film: the LED display opens it, its cursor opens into the Mac's screen for the tour of the
 * interface, and the display returns for the call to action. Every moment is placed by the timeline
 * the soundtrack is scored from.
 */
export function Promo({ lang }: { lang: Lang }) {
  // Frames render in parallel tabs, each mounting only the scenes on screen, so the film's root
  // holds every frame until the faces have loaded.
  useFontsReady();
  return (
    <AbsoluteFill className="film">
      <Plate />
      <Sequence name="Intro" durationInFrames={toFrames(INTRO.morph + 1)}>
        <Intro lang={lang} />
      </Sequence>
      <Sequence
        name="Stage"
        from={toFrames(STAGE.start)}
        durationInFrames={toFrames(STAGE.end - STAGE.start)}
      >
        <Stage lang={lang} />
      </Sequence>
      <Sequence
        name="Features"
        from={toFrames(FEATURES.start)}
        durationInFrames={toFrames(FEATURES.end - FEATURES.start)}
      >
        <Features lang={lang} />
      </Sequence>
      <Sequence
        name="Privacy"
        from={toFrames(PRIVACY.start)}
        durationInFrames={toFrames(PRIVACY.end - PRIVACY.start)}
      >
        <Privacy lang={lang} />
      </Sequence>
      <Sequence
        name="Outro"
        from={toFrames(OUTRO.start)}
        durationInFrames={toFrames(OUTRO.end - OUTRO.start)}
      >
        <Outro lang={lang} />
      </Sequence>
      {/* Synthesized from the same timeline by scripts/soundtrack.ts, so every cue is on its frame. */}
      <Audio src={staticFile('audio/soundtrack.wav')} />
    </AbsoluteFill>
  );
}
