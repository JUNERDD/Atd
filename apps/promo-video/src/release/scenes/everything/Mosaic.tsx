import type { Lang } from '../../../copy.ts';
import type { CameraState } from '../../../kit/world/camera.ts';
import { releaseCopy } from '../../copy.ts';
import { Statement } from '../../world/Statement.tsx';
import { BRAND_TURNS, EVERYTHING_BEATS as B, WORD_HITS } from './beats.ts';
import { TILES, WALLS, WORD_ANCHORS } from './layout.ts';
import { flightAt, glintAt, inFrame, litAt } from './motion.ts';
import { Tile } from './Tile.tsx';
import { Vignette } from './Vignette.tsx';

interface MosaicProps {
  lang: Lang;
  t: number;
  cam: CameraState;
}

/**
 * The world the camera looks at: every tile in its cell of the "0.8" matrix with its live
 * vignette, and each hero's word slamming into the digit's hole beside it on its hit, leaving an
 * eighth before the next. The point's tile hands over to the scene's caret when it starts to rise.
 */
export function Mosaic({ lang, t, cam }: MosaicProps) {
  const words = releaseCopy[lang].everything.words;
  return (
    <div className="r08-every__world">
      {TILES.map((spec) => {
        if (spec.kind === 'point' && t >= B.morph) return null;
        const flight = spec.kind === 'point' ? undefined : flightAt(t, spec.rect, cam);
        if (flight?.gone) return null;
        return (
          <Tile
            key={spec.id}
            spec={spec}
            t={t}
            wall={WALLS[spec.kind]}
            visible={inFrame(cam, spec.rect)}
            turns={BRAND_TURNS[spec.id]}
            glint={glintAt(t, spec.rect)}
            flight={flight}
            lit={litAt(t)}
          >
            {(turned) => (
              <Vignette lang={lang} t={t} age={t - spec.arrive} turned={turned} spec={spec} />
            )}
          </Tile>
        );
      })}
      {WORD_HITS.map((hit, index) => {
        const anchor = WORD_ANCHORS[index]!;
        const next = WORD_HITS[index + 1] ?? B.pullback + 0.15;
        if (t < hit - 0.05 || t > next + 0.4) return null;
        return (
          <div
            key={hit}
            className="r08-every__word"
            data-align={anchor.align}
            style={{ '--ev-x': anchor.x, '--ev-y': anchor.y }}
          >
            <Statement
              t={t}
              lang={lang}
              text={words[index] ?? ''}
              at={hit}
              motion="slam"
              out={next - 0.15}
              align={anchor.align === 'left' ? 'left' : 'center'}
            />
          </div>
        );
      })}
    </div>
  );
}
