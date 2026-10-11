import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { useFontsReady } from '../../../fonts.ts';
import { CaretWipe } from '../CaretWipe.tsx';
import { SelectionFlood } from '../SelectionFlood.tsx';
import { StagePage } from './StagePage.tsx';
import { StatementPage } from './StatementPage.tsx';
import { TypePage } from './TypePage.tsx';
import '../release.css';
import './sheet.css';

/** The sheet's length: four bars. */
export const SHEET_LENGTH = 9.6;

const WIPE = { at: 3.0, duration: 0.6 };
const FLOOD = { at: 6.0, duration: 0.6, release: 0.35 };
/** The title's "0.8", where the flood starts, in frame px. */
const FLOOD_FROM = { x: 975, y: 330, width: 330, height: 200 };

/**
 * The release world kit's review sheet (composition `R08WorldSheet`, 9.6 s): every component
 * animating, so stills at any frame prove them. 0–3.6 s: the dot field's pulses, the caret, a line
 * typed, selected and retyped (English and Chinese). 3.0–3.6 s: a caret wipe into the statements:
 * the title slammed in, its line typed, a Chinese statement rising, all leaving. 6.0–6.95 s: a
 * selection flood into the Stage: the display's wallpaper, glows and glass under a camera push,
 * pulses from a click and from where the island lands, a line written back at the shipped pace.
 */
export function ReleaseWorldSheet() {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const wiped = t >= WIPE.at + WIPE.duration;
  const flooded = t >= FLOOD.at + FLOOD.duration + FLOOD.release;
  return (
    <AbsoluteFill className="scene r08">
      {wiped ? null : (
        <CaretWipe
          t={t}
          {...WIPE}
          outgoing={<TypePage t={t} />}
          incoming={<StatementPage t={t} />}
        />
      )}
      {wiped && !flooded ? (
        <>
          <StatementPage t={t} />
          <SelectionFlood t={t} {...FLOOD} from={FLOOD_FROM} incoming={<StagePage t={t} />} />
        </>
      ) : null}
      {flooded ? <StagePage t={t} /> : null}
    </AbsoluteFill>
  );
}
