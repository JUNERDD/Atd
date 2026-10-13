import { Composition, Folder } from 'remotion';
// The base stylesheet loads before the components' own, which build on it.
import './styles/film.css';
import { ProductSheet } from './kit/product/Sheet.tsx';
import { WorldSheet } from './kit/world/Sheet.tsx';
import { Promo } from './Promo.tsx';
import { ReleaseFilm } from './release/ReleaseFilm.tsx';
import { RELEASE_SCENES } from './release/scenes.ts';
import { RELEASE_DURATION, RELEASE_SECTIONS } from './release/timeline.ts';
import { ReleaseWorldSheet, SHEET_LENGTH } from './release/world/sheet/ReleaseWorldSheet.tsx';
import { SCENES } from './scenes.ts';
import { DURATION, FPS, HEIGHT, SECTIONS, toFrames, WIDTH } from './timeline.ts';

const FRAME = { width: WIDTH, height: HEIGHT, fps: FPS } as const;

/**
 * The film in English and Chinese, each section on its own timeline, the 0.8 release film with its
 * sections and its world's review sheet, and the kits' review sheets. Lengths come from each film's timeline, so the
 * compositions never drift from the soundtrack it scores.
 */
export function RemotionRoot() {
  return (
    <>
      <Composition
        id="AtdPromo"
        component={Promo}
        {...FRAME}
        durationInFrames={toFrames(DURATION)}
        defaultProps={{ lang: 'en' }}
      />
      <Composition
        id="AtdPromoZh"
        component={Promo}
        {...FRAME}
        durationInFrames={toFrames(DURATION)}
        defaultProps={{ lang: 'zh' }}
      />
      <Folder name="Scenes">
        {SCENES.map(({ id, name, Scene }) => (
          <Composition
            key={id}
            id={name}
            component={Scene}
            {...FRAME}
            durationInFrames={toFrames(SECTIONS[id].end - SECTIONS[id].start)}
            defaultProps={{ lang: 'en' as const }}
          />
        ))}
      </Folder>
      <Folder name="Release">
        <Composition
          id="AtdRelease"
          component={ReleaseFilm}
          {...FRAME}
          durationInFrames={toFrames(RELEASE_DURATION)}
          defaultProps={{ lang: 'en' as const }}
        />
        <Composition
          id="AtdReleaseZh"
          component={ReleaseFilm}
          {...FRAME}
          durationInFrames={toFrames(RELEASE_DURATION)}
          defaultProps={{ lang: 'zh' as const }}
        />
        {RELEASE_SCENES.map(({ id, name, Scene }) => (
          <Composition
            key={id}
            id={name}
            component={Scene}
            {...FRAME}
            durationInFrames={toFrames(RELEASE_SECTIONS[id].end - RELEASE_SECTIONS[id].start)}
            defaultProps={{ lang: 'en' as const }}
          />
        ))}
        <Composition
          id="R08WorldSheet"
          component={ReleaseWorldSheet}
          {...FRAME}
          durationInFrames={toFrames(SHEET_LENGTH)}
        />
      </Folder>
      <Folder name="Kits">
        <Composition
          id="WorldSheet"
          component={WorldSheet}
          {...FRAME}
          durationInFrames={toFrames(8)}
        />
        <Composition
          id="ProductSheet"
          component={ProductSheet}
          {...FRAME}
          durationInFrames={toFrames(8)}
          defaultProps={{ lang: 'en' as const }}
        />
      </Folder>
    </>
  );
}
