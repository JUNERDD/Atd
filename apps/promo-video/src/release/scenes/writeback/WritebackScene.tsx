import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../../../copy.ts';
import { useFontsReady } from '../../../fonts.ts';
import { DotField } from '../../world/DotField.tsx';
import { SelectionFlood } from '../../world/SelectionFlood.tsx';
import { WRITEBACK_BEATS as B } from './beats.ts';
import { content } from './content.ts';
import { Montage } from './Montage.tsx';
import { floodFrom } from './montage-frame.ts';
import { RoundTrip } from './RoundTrip.tsx';
import { DestinationLabels, RoundTripWords } from './Words.tsx';
import './writeback.css';

/**
 * The round trip (bars 3–8). It opens on the bare Stage the open's wipe revealed: a note fades up,
 * ⌥ is held as a drag selects its rough paragraph, the selection toolbar grows out of it and
 * Polish writing is clicked; one camera move follows the run down to the command island and races
 * back up as the polished text types over the selection, then pulls back for Written. The words
 * "Select. Ask. It writes back." land in the left column on those beats. Bar 6 cuts through the
 * three write-back destinations, half a bar each, labelled verbatim, then the fallback (a page that
 * can't take text: the answer card, Copy, "Copied"); its selection floods the frame and clears
 * onto the bare dot field `choose` starts from.
 */
export function WritebackScene({ lang }: { lang: Lang }) {
  useFontsReady();
  const t = useCurrentFrame() / useVideoConfig().fps;
  const c = content[lang];
  const montage = t >= B.destinations;
  return (
    <AbsoluteFill className="scene r08">
      {montage ? <Montage lang={lang} c={c} t={t} /> : <RoundTrip lang={lang} c={c} t={t} />}
      {montage ? (
        <DestinationLabels lang={lang} c={c} t={t} />
      ) : (
        <RoundTripWords lang={lang} c={c} t={t} />
      )}
      <SelectionFlood
        t={t}
        at={B.flood}
        duration={B.floodLength}
        release={B.floodRelease}
        from={floodFrom(c, B.flood)}
        incoming={<DotField t={0} />}
      />
    </AbsoluteFill>
  );
}
