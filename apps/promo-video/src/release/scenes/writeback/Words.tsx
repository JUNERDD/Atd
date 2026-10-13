import type { Lang } from '../../../copy.ts';
import { langTag } from '../../../kit/world/text-units.ts';
import { ramp } from '../../../motion/ease.ts';
import { Statement } from '../../world/Statement.tsx';
import {
  WRITEBACK_BEATS as B,
  WRITEBACK_MONTAGE,
  WRITEBACK_WORDS as W,
  type DemoId,
} from './beats.ts';
import type { WritebackContent } from './content.ts';
import { COLUMN } from './layout.ts';

/** A label is gone just as the next lands (the rise's exit fades in 0.24 s). */
const LABEL_EXIT = 0.24;

/** Each word's top in the column, in frame px; English's last line wraps, so it sits higher. */
const TOPS: Record<Lang, readonly [number, number, number]> = {
  en: [282, 410, 538],
  zh: [318, 446, 574],
};

/**
 * One line of the stack: it rises on its beat, steps back to a dim grey as the next lands, and
 * leaves with the island. Nothing is drawn before it lands, so frame 0 stays the bare Stage.
 */
function StackLine(props: {
  lang: Lang;
  t: number;
  text: string;
  at: number;
  top: number;
  next?: number;
}) {
  const { lang, t, text, at, top, next } = props;
  if (t < at) return null;
  const dim = next === undefined ? 0 : ramp(t, next, 0.35);
  return (
    <div className="r08-wb-word" style={{ '--top': top, '--o': 1 - 0.62 * dim }}>
      <Statement
        t={t}
        lang={lang}
        text={text}
        at={at}
        stagger={0.06}
        align="left"
        out={B.wordsOut}
      />
    </div>
  );
}

/**
 * The round trip's words in the left column, each on the beat of its action: "Select." with the
 * drag, "Ask." with the click, "It writes back." with the first chunk typed back.
 */
export function RoundTripWords({ lang, c, t }: { lang: Lang; c: WritebackContent; t: number }) {
  const [select, ask, back] = TOPS[lang];
  return (
    <div className="r08-wb-column" style={{ '--left': COLUMN.left, '--width': COLUMN.width }}>
      <StackLine lang={lang} t={t} text={c.words.select} at={W.select} top={select} next={W.ask} />
      <StackLine lang={lang} t={t} text={c.words.ask} at={W.ask} top={ask} next={W.back} />
      <StackLine lang={lang} t={t} text={c.words.back} at={W.back} top={back} />
    </div>
  );
}

/** The fallback's hit: the "When done" kicker belongs to the destinations and leaves before it. */
const FALLBACK_HIT = WRITEBACK_MONTAGE.find((hit) => hit.id === 'unwritten')?.at ?? B.end;

/**
 * The montage's column: the options' own kicker ("When done") over each destination's label,
 * verbatim, rolling in on its hit as the one before rolls out; then, without the kicker, the
 * fallback's narrative line.
 */
export function DestinationLabels({ lang, c, t }: { lang: Lang; c: WritebackContent; t: number }) {
  const kicker =
    ramp(t, B.destinations, 0.3) * (1 - ramp(t, FALLBACK_HIT - LABEL_EXIT, LABEL_EXIT));
  return (
    <div className="r08-wb-column" style={{ '--left': COLUMN.left, '--width': COLUMN.width }}>
      <p
        className="r08-wb-kicker"
        lang={langTag(lang)}
        style={{ '--o': kicker, '--rise': (1 - kicker) * 14 }}
      >
        {c.montage.kicker}
      </p>
      {WRITEBACK_MONTAGE.map((hit, index) => {
        const next = WRITEBACK_MONTAGE[index + 1];
        if (t < hit.at || (next && t >= next.at)) return null;
        const id: DemoId = hit.id;
        return (
          <div key={id} className="r08-wb-label" data-fallback={id === 'unwritten' || undefined}>
            <Statement
              t={t}
              lang={lang}
              text={c.montage.labels[id]}
              at={hit.at}
              stagger={0.035}
              align="left"
              {...(next ? { out: next.at - LABEL_EXIT, outStagger: 0 } : {})}
            />
          </div>
        );
      })}
    </div>
  );
}
