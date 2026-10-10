import { Folder } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { Lang } from '../../copy.ts';
import { CreatedCard } from '../../kit/product/CreatedCard.tsx';
import { clamp01, easeIn, easeInOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { TOOLS } from './beats.ts';
import { content } from './content.ts';

/** How long a card takes to fall from the lens onto its place: it lands exactly on its beat. */
const FALL = 0.17;

/** Each card's resting place, in frame px from the stage's centre, fanning left to right. */
const FAN = [
  { x: -440, y: -70, rotate: -5 },
  { x: 0, y: -18, rotate: -1 },
  { x: 440, y: 40, rotate: 4 },
] as const;

/** The impact: a quick give as the card hits, then a small rebound. */
function impact(t: number, landed: number): number {
  const u = t - landed;
  if (u <= 0) return 0;
  return Math.exp(-u * 11) * Math.sin(Math.min(u, 0.6) * 26) * 0.045;
}

/**
 * The three things the agent made when asked (a command, a skill, an automation), each falling
 * from the lens and slamming onto its beat, fanned across the frame in depth. Each confirms with
 * its check; every landing pushes the cards before it back. From `pullOut` the first two fall away
 * and the camera pulls back with the automation card into the dusk.
 */
export function ToolsBeat({ lang, t }: { lang: Lang; t: number }) {
  const c = content[lang].tools;
  const [first] = TOOLS.cards;
  if (t < first - FALL) return null;
  const cards: ComponentProps<typeof CreatedCard>[] = [
    { lang, kind: 'command', name: c.command, keys: ['⌥', 'T'] },
    { lang, kind: 'skill', name: c.skill, detail: c.skillDetail },
    { lang, kind: 'automation', name: c.automation, detail: c.trigger, detailIcon: Folder },
  ];
  const pull = ramp(t, TOOLS.pullOut, 1.15, easeInOut);
  const away = ramp(t, TOOLS.pullOut, 0.55, easeIn);
  return (
    <div className="anything-tools">
      {cards.map((card, index) => {
        const landed = TOOLS.cards[index] ?? Infinity;
        if (t < landed - FALL) return null;
        const fall = ramp(t, landed - FALL, FALL, easeIn);
        // Later cards push this one back as they land.
        const behind = TOOLS.cards
          .slice(index + 1)
          .reduce((sum, later) => sum + springAt(t, later, springs.window), 0);
        const last = index === cards.length - 1;
        const place = FAN[index] ?? FAN[1];
        const leaving = last ? 0 : away;
        return (
          <div
            key={card.kind}
            className="anything-card"
            style={{
              '--x': `${mix(place.x, 0, last ? pull : 0) - behind * 26 * Math.sign(place.x || -1)}px`,
              '--y': `${mix(place.y, -30, last ? pull : 0) - behind * 14}px`,
              '--z': `${mix(900, 0, fall) - behind * 210 - leaving * 1500 - (last ? pull * 2300 : 0)}px`,
              '--r': `${mix(place.rotate * 2.2, place.rotate, fall) * (last ? 1 - pull : 1)}deg`,
              '--s': 1 - impact(t, landed),
              '--o': clamp01(fall * 2.2) * (1 - leaving),
              '--blur': `${(1 - fall) * 14 + behind * 0.6 + (last ? pull * 1.5 : leaving * 6)}px`,
              '--dim': 1 - behind * 0.12,
            }}
          >
            <CreatedCard {...card} confirm={t - landed - TOOLS.confirm} />
          </div>
        );
      })}
    </div>
  );
}
