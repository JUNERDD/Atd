import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../../../copy.ts';
import { useFontsReady } from '../../../fonts.ts';
import { ISLAND_HOME } from '../../../kit/product/island.ts';
import { DotField } from '../../world/DotField.tsx';
import type { Pulse } from '../../world/dots.ts';
import { SelectionFlood } from '../../world/SelectionFlood.tsx';
import { CHOOSE_BEATS as B, chooseKeys } from './beats.ts';
import { KeyCam } from './KeyCam.tsx';
import { KEYS_AT, SCREEN_CENTER, toFrameAt, toFrameRectAt } from './layout.ts';
import { insertBox } from './note-layout.ts';
import { Screen } from './Screen.tsx';
import { Words } from './Words.tsx';
import './choose.css';

/**
 * Rings through the world's dots: a soft one as the screen arrives, a coral fleck under every
 * key that goes down (firmer for the key that completes a chord), and a white ring leaving the
 * island wherever it stands in the frame as it opens into the card and as each run is Written.
 */
function worldPulses(lang: Lang): Pulse[] {
  const out: Pulse[] = [{ ...SCREEN_CENTER, at: B.screenIn, strength: 0.7, speed: 900 }];
  chooseKeys.forEach((key, index) => {
    const completes = index === 1 || index === 3;
    out.push({
      ...KEYS_AT,
      at: key.down,
      strength: completes ? 0.7 : 0.4,
      speed: 760,
      tint: 'coral',
    });
  });
  for (const [at, strength] of [
    [B.cardOpen, 0.75],
    [B.tapDone, 0.45],
    [B.holdDone, 0.55],
    [B.whereDone, 0.7],
  ] as const) {
    out.push({ ...toFrameAt(lang, at, ISLAND_HOME), at, strength, speed: 1000 });
  }
  return out;
}

/**
 * Choose: how a run is chosen without opening the panel. The section rises out of the bare dot
 * field: a window onto the Mac on the right, the macro keys and the words on the left. A tap of
 * ⌥P runs Polish writing as last time; holding ⌥T charges the press capsule and grows the island
 * into Translate's options, where the keyboard picks Japanese; then, with the mouse, the split
 * chevron's menu says where this one run's answer goes (When done → Insert after the selected
 * text), and it lands after the selection. That new text's selection floods the frame and clears
 * to the bare dot field: the last frame is exactly the next section's first (`<DotField t={0} />`).
 */
export function ChooseScene({ lang }: { lang: Lang }) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill className="scene r08">
      <DotField t={t} pulses={worldPulses(lang)} />
      <Screen lang={lang} t={t} />
      <KeyCam t={t} />
      <Words lang={lang} t={t} />
      <SelectionFlood
        t={t}
        at={B.flood}
        duration={B.floodLength}
        release={B.floodRelease}
        from={toFrameRectAt(lang, t, insertBox(lang))}
        incoming={<DotField t={Math.min(0, t - B.end + 1 / fps)} />}
      />
    </AbsoluteFill>
  );
}
