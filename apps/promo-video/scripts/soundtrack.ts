/**
 * Scores the film from its timeline: renders the music and the sound effects, gives each its share
 * of one reverb, masters the mix to a streaming loudness and writes `public/audio/soundtrack.wav`,
 * the track the film plays. The unmastered stems go beside it for anyone editing the cut.
 *
 * Run with `pnpm --filter @atd/promo-video soundtrack`; `studio` and the render scripts run it first.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCues } from '../src/audio/cues.ts';
import { addStereo, stereo, type Stereo } from '../src/audio/dsp.ts';
import { fadeEnds, gain, limit, loudness, peakDb, wav } from '../src/audio/master.ts';
import { reverb } from '../src/audio/reverb.ts';
import { duck, renderScore } from '../src/audio/score.ts';
import { DURATION } from '../src/timeline.ts';

/** Integrated loudness for web and social video; the platforms normalize near -14 LUFS. */
const TARGET_LUFS = -15;
const WET = 1.1;

const started = performance.now();
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

function sum(...buses: [Stereo, number][]): Stereo {
  const out = stereo(DURATION);
  for (const [bus, level] of buses) addStereo(out, bus, level);
  return out;
}

const score = renderScore();
duck(score);
const cues = renderCues();
const music = sum([score.ducked, 1], [score.dry, 1], [reverb(score.send), WET]);
const effects = sum([cues.dry, 1], [reverb(cues.send, 0.8, 0.4), WET]);
const mix = sum([music, 1], [effects, 1]);

fadeEnds(mix, 0.01, 1.6);
const measured = loudness(mix);
const makeup = 10 ** ((TARGET_LUFS - measured) / 20);
gain(mix, makeup);
limit(mix, -1);

mkdirSync(join(directory, 'stems'), { recursive: true });
writeFileSync(join(directory, 'soundtrack.wav'), wav(mix));
for (const [name, stem] of [
  ['music', music],
  ['effects', effects],
] as const) {
  gain(stem, makeup);
  writeFileSync(join(directory, 'stems', `${name}.wav`), wav(stem));
}

console.log(
  `soundtrack: ${loudness(mix).toFixed(1)} LUFS (was ${measured.toFixed(1)}), peak ${peakDb(mix).toFixed(1)} dBFS, ` +
    `${((performance.now() - started) / 1000).toFixed(1)} s → ${join(directory, 'soundtrack.wav')}`,
);
