import type { Lang } from '../../copy.ts';
import type { Point } from '../world/points.ts';
import { IslandCapsule } from './IslandCapsules.tsx';
import { ISLAND_HOME, islandAt } from './island.ts';
import { AnswerCard } from './AnswerCard.tsx';
import { isCard, islandSize, type IslandMoment } from './island-layout.ts';
import { OptionsCard } from './OptionsCard.tsx';
import './tokens.css';
import './island.css';

interface CommandIslandProps {
  lang: Lang;
  /** Seconds on the caller's clock. */
  t: number;
  /** What the island shows, in time order; the first enters it. */
  moments: readonly IslandMoment[];
  /** When it leaves, if it does. */
  exit?: number | undefined;
  /** The middle of its bottom edge, in the layer's points. Default `ISLAND_HOME`. */
  anchor?: Point | undefined;
  /**
   * The answer card's live state while it shows: how far its answer has scrolled (pt), and the
   * button held down.
   */
  answer?: { scroll?: number | undefined; pressed?: 'copy' | 'open' | undefined } | undefined;
}

/**
 * The command island (`IslandView.swift`): one glass shape that grows upward from the middle of its
 * bottom edge and morphs between its contents (the press, working, writing, written and copied
 * capsules, the options card and the answer card), each laid out at its own size, centred in the
 * shape and scaling with it, arriving out of a blur once the one before has left. Place it in a
 * layer laid out in the display's points.
 */
export function CommandIsland({
  lang,
  t,
  moments,
  exit,
  anchor = ISLAND_HOME,
  answer,
}: CommandIslandProps) {
  const sizes = moments.map(({ content }) => islandSize(lang, content));
  const steps = moments.map(({ at, content }, index) => ({
    at,
    size: sizes[index] ?? { width: 0, height: 0 },
    card: isCard(content),
  }));
  const frame = islandAt(t, steps, exit);
  if (!frame.shown) return null;
  return (
    <div className="pk-island" style={{ '--x': anchor.x, '--y': anchor.y, '--o': frame.opacity }}>
      <div
        className="glass pk-island__shape"
        style={{
          '--w': frame.shape.width,
          '--h': frame.shape.height,
          '--r': frame.shape.radius,
          '--s': frame.scale,
          '--drop': frame.drop,
        }}
      >
        {frame.layers.map((layer) => {
          const moment = moments[layer.index];
          const size = sizes[layer.index];
          if (!moment || !size) return null;
          const { content } = moment;
          return (
            <div
              key={layer.index}
              className="pk-island__layer"
              style={{
                '--lw': size.width,
                '--lh': size.height,
                '--ls': layer.scale,
                '--lo': layer.opacity,
                '--lb': layer.blur,
              }}
            >
              {content.kind === 'card' ? (
                <OptionsCard lang={lang} card={content.card} t={t} />
              ) : content.kind === 'answer' ? (
                <AnswerCard
                  lang={lang}
                  card={content.card}
                  scroll={answer?.scroll}
                  pressed={answer?.pressed}
                />
              ) : (
                <IslandCapsule lang={lang} content={content} t={t} age={t - moment.at} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
