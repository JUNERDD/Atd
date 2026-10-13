import type { Lang } from '../../../copy.ts';
import { textUnits } from '../../../kit/world/text-units.ts';
import { Statement } from '../../world/Statement.tsx';
import { CHOOSE_BEATS as B, chooseWordTimes } from './beats.ts';
import { content } from './content.ts';
import { COLUMN } from './layout.ts';

/**
 * The section's three statements in the left column, rising word by word on the grid: "Tap to
 * run." with the tap, "Hold to choose." ending on the card's arrival, and "This time, put it
 * here." ending on the pick, a little lower since the keys have gone by then. The verb (or, last,
 * "here") is the coral word. A Chinese statement breaks after its comma, as a typesetter would
 * set it, rather than wherever the column ends.
 */
export function Words({ lang, t }: { lang: Lang; t: number }) {
  const { words } = content[lang];
  const times = chooseWordTimes(lang);
  const lines = [
    { text: words.tap, times: times.tap, out: B.tapWordOut, accent: 0, top: 236 },
    { text: words.hold, times: times.hold, out: B.holdWordOut, accent: 0, top: 236 },
    {
      text: words.where,
      times: times.where,
      out: undefined,
      accent: textUnits(words.where, lang).length - 1,
      top: 352,
    },
  ];
  return (
    <>
      {lines.map((line) => {
        const first = line.times[0] ?? 0;
        if (t < first || (line.out !== undefined && t > line.out + 0.5)) return null;
        return (
          <div
            key={line.text}
            className="r08-choose__words"
            style={{ '--wx': COLUMN.x, '--ww': COLUMN.width, '--wy': line.top }}
          >
            <Statement
              t={t}
              lang={lang}
              text={lang === 'zh' ? line.text.replace('，', '，\n') : line.text}
              at={first}
              times={line.times}
              align="left"
              accent={[line.accent]}
              {...(line.out === undefined ? {} : { out: line.out })}
            />
          </div>
        );
      })}
    </>
  );
}
