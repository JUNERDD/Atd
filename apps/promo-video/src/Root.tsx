import { Composition, Folder } from 'remotion';
// The base stylesheet loads before the scenes' own, which build on it.
import './styles/film.css';
import { Promo } from './Promo.tsx';
import { Features } from './scenes/features/Features.tsx';
import { Intro } from './scenes/intro/Intro.tsx';
import { Outro } from './scenes/outro/Outro.tsx';
import { Privacy } from './scenes/privacy/Privacy.tsx';
import { Stage } from './stage/Stage.tsx';
import {
  DURATION,
  FEATURES,
  FPS,
  HEIGHT,
  INTRO,
  OUTRO,
  PRIVACY,
  STAGE,
  toFrames,
  WIDTH,
} from './timeline.ts';

/**
 * The film in English and Chinese, plus its larger scenes on their own timelines. Lengths come from
 * the timeline, so the compositions never drift from the soundtrack it scores.
 */
export function RemotionRoot() {
  return (
    <>
      <Composition
        id="AtdPromo"
        component={Promo}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={toFrames(DURATION)}
        defaultProps={{ lang: 'en' }}
      />
      <Composition
        id="AtdPromoZh"
        component={Promo}
        width={WIDTH}
        height={HEIGHT}
        fps={FPS}
        durationInFrames={toFrames(DURATION)}
        defaultProps={{ lang: 'zh' }}
      />
      <Folder name="Scenes">
        <Composition
          id="Intro"
          component={Intro}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={toFrames(INTRO.morph + 1)}
          defaultProps={{ lang: 'en' }}
        />
        <Composition
          id="Stage"
          component={Stage}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={toFrames(STAGE.end - STAGE.start)}
          defaultProps={{ lang: 'en' }}
        />
        <Composition
          id="Features"
          component={Features}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={toFrames(FEATURES.end - FEATURES.start)}
          defaultProps={{ lang: 'en' }}
        />
        <Composition
          id="Privacy"
          component={Privacy}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={toFrames(PRIVACY.end - PRIVACY.start)}
          defaultProps={{ lang: 'en' }}
        />
        <Composition
          id="Outro"
          component={Outro}
          width={WIDTH}
          height={HEIGHT}
          fps={FPS}
          durationInFrames={toFrames(OUTRO.end - OUTRO.start)}
          defaultProps={{ lang: 'en' }}
        />
      </Folder>
    </>
  );
}
