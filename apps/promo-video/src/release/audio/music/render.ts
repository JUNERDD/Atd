/**
 * The 0.8 release film's music, in C♯ minor lifting to E major at 100 BPM, rendered into the
 * buses the master expects (`MusicBuses`): pad, keys, strings and bass ducked under the kick; drums,
 * gestures and the pulse lead dry; a share of each sent to the plate. The pulse lead and the strings
 * each get a dotted-eighth ping-pong echo, and the pad bed is widened by a chorus. `harmony.ts`
 * holds the chords and the hook, `form.ts` the bar-by-bar arrangement.
 */
import { echo, chorus } from '../../../audio/delay.ts';
import { addStereo, prng, stereo, type Stereo } from '../../../audio/dsp.ts';
import type { MusicBuses } from '../../../audio/master.ts';
import { BEAT, RELEASE_DURATION } from '../../timeline.ts';
import { drumBar } from './drums.ts';
import { FORM } from './form.ts';
import { hits, hook, opening, risers } from './gestures.ts';
import { bass, breathe, keys, pad, strings } from './parts.ts';

/** A dotted eighth at 100 BPM: three sixteenths, 0.45 s. */
const DOTTED_EIGHTH = BEAT * 0.75;

/** Adds a centred mono bed and its chorus to a bus. */
function widen(out: Stereo, bed: Float32Array, dry: number, wide: number): void {
  const sides = chorus(bed);
  for (let i = 0; i < out.left.length; i++) {
    const centre = (bed[i] ?? 0) * dry;
    out.left[i] = (out.left[i] ?? 0) + centre + (sides.left[i] ?? 0) * wide;
    out.right[i] = (out.right[i] ?? 0) + centre + (sides.right[i] ?? 0) * wide;
  }
}

export function renderReleaseMusic(): MusicBuses {
  const seconds = RELEASE_DURATION;
  const buses: MusicBuses = {
    ducked: stereo(seconds),
    dry: stereo(seconds),
    send: stereo(seconds),
    kicks: [],
  };
  const random = prng(808);

  const bed = new Float32Array(buses.ducked.left.length);
  pad(bed, seconds, random);
  widen(buses.ducked, bed, 0.55, 0.75);
  widen(buses.send, bed, 0.25, 0.3);

  const plucked = stereo(seconds);
  for (const [bar] of FORM.entries()) {
    drumBar(buses, bar, random);
    keys(buses, bar);
    bass(buses, bar);
    strings(plucked, bar, random);
  }
  addStereo(buses.ducked, plucked);
  addStereo(buses.send, plucked, 0.35);
  addStereo(buses.ducked, echo(plucked, { time: DOTTED_EIGHTH, feedback: 0.35 }), 0.32);

  const lead = stereo(seconds);
  hook(lead);
  addStereo(buses.dry, lead);
  addStereo(buses.send, lead, 0.3);
  const repeats = echo(lead, { time: DOTTED_EIGHTH, feedback: 0.4, damp: 3200 });
  addStereo(buses.dry, repeats, 0.3);
  addStereo(buses.send, repeats, 0.15);

  opening(buses, random);
  risers(buses, random);
  breathe(buses);
  hits(buses, random);
  return buses;
}
