import type { Lang } from '../../../copy.ts';
import { CommandIsland } from '../../../kit/product/CommandIsland.tsx';
import { Camera } from '../../../kit/world/Camera.tsx';
import { Cursor } from '../../../kit/world/Cursor.tsx';
import { cursorAt } from '../../../kit/world/cursor.ts';
import { ramp } from '../../../motion/ease.ts';
import { MAC_CHROME } from '../../../kit/world/chrome.ts';
import { Stage } from '../../world/Stage.tsx';
import { demoTimes, FALLBACK, WRITEBACK_ISLAND as I, WRITEBACK_MONTAGE } from './beats.ts';
import type { WritebackContent } from './content.ts';
import { DemoField } from './DemoField.tsx';
import { DEMO, DEMO_AIM, ISLAND_ANCHOR, ISLAND_MIDDLE } from './layout.ts';
import { copyButton, demoAt, demoCamera, fallbackCard } from './montage-frame.ts';

interface MontageProps {
  lang: Lang;
  c: WritebackContent;
  t: number;
}

/**
 * The fallback for a field that can't take text: the island grows into the answer card (the
 * command's name, why it wasn't written, the answer), the pointer comes down to Copy and clicks
 * it, and the card turns into "Copied".
 */
function Fallback({ lang, c, t }: MontageProps) {
  const card = fallbackCard(c);
  const copy = copyButton(lang, card);
  const pointer = cursorAt(t, [
    { at: FALLBACK.card, x: DEMO.x + DEMO.width - 40, y: DEMO.y + DEMO.height - 30 },
    { at: FALLBACK.hover, ...copy, travel: 0.3 },
    { at: FALLBACK.copy, ...copy, press: true },
  ]);
  const pressed = t > FALLBACK.copy - 0.04 && t < FALLBACK.copy + 0.08;
  return (
    <>
      <CommandIsland
        lang={lang}
        t={t}
        anchor={ISLAND_ANCHOR}
        moments={[
          { at: I.card, content: { kind: 'answer', card } },
          { at: I.copied, content: { kind: 'copied' } },
        ]}
        answer={pressed ? { pressed: 'copy' } : undefined}
      />
      <Cursor state={pointer} opacity={ramp(t, FALLBACK.card, 0.15)} />
    </>
  );
}

/**
 * The destinations, half a bar each, hard cuts on the half bars: the same glass window holding a
 * different paragraph each time, framed close, the answer typed where that destination puts it.
 * The fallback pulls back far enough to show the island's answer card under the read-only page.
 */
export function Montage({ lang, c, t }: MontageProps) {
  const demo = demoAt(t);
  if (!demo) return null;
  const answer = demoTimes(lang, demo.id);
  return (
    <Camera state={demoCamera(t)}>
      <Stage
        lang={lang}
        t={t}
        appName={c.app}
        menus={MAC_CHROME[lang].menus.app}
        pulses={[
          ...WRITEBACK_MONTAGE.flatMap((hit) =>
            hit.type === null
              ? []
              : [{ ...DEMO_AIM, at: hit.type, strength: 0.55, tint: 'coral' as const }],
          ),
          { ...ISLAND_MIDDLE, at: I.card, strength: 0.8 },
        ]}
      >
        <DemoField lang={lang} id={demo.id} demo={c.montage.demos[demo.id]} t={t} answer={answer} />
        {demo.id === 'unwritten' ? <Fallback lang={lang} c={c} t={t} /> : null}
      </Stage>
    </Camera>
  );
}
