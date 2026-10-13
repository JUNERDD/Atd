/**
 * Scores each film from its timeline: renders the music and the sound effects, mixes and masters
 * them (`mixdown`) and writes the track the film plays to `public/audio/`, with the stems beside it
 * for anyone editing the cut.
 *
 *   node scripts/soundtrack.ts [launch|release-en|release-zh|release|all]
 *
 * With no film named it scores the launch film's `soundtrack.wav`. The release film types on
 * screen in each cut's language, so each cut has its own track: `release-en` scores
 * `release-en.wav`, `release-zh` scores `release-zh.wav`, and `release` scores both.
 * `pnpm --filter @atd/promo-video soundtrack` scores the launch film, `studio` scores every film
 * and the render script scores the films its cuts need.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EffectBuses } from '../src/audio/cue-bus.ts';
import { renderCues } from '../src/audio/cues.ts';
import { loudness, mixdown, type MusicBuses, peakDb, wav } from '../src/audio/master.ts';
import { renderScore } from '../src/audio/score.ts';
import { renderReleaseCues } from '../src/release/audio/cues.ts';
import { renderReleaseScore } from '../src/release/audio/score.ts';
import { RELEASE_DURATION } from '../src/release/timeline.ts';
import { DURATION } from '../src/timeline.ts';

interface Film {
  seconds: number;
  score: () => MusicBuses;
  cues: () => EffectBuses;
  /** The track's file name, and the prefix of its stems' names. */
  track: string;
  stems: string;
}

const FILMS = {
  launch: {
    seconds: DURATION,
    score: renderScore,
    cues: renderCues,
    track: 'soundtrack.wav',
    stems: '',
  },
  'release-en': {
    seconds: RELEASE_DURATION,
    score: renderReleaseScore,
    cues: () => renderReleaseCues('en'),
    track: 'release-en.wav',
    stems: 'release-en-',
  },
  'release-zh': {
    seconds: RELEASE_DURATION,
    score: renderReleaseScore,
    cues: () => renderReleaseCues('zh'),
    track: 'release-zh.wav',
    stems: 'release-zh-',
  },
} satisfies Record<string, Film>;
/** The films this script scores; `scripts/render.ts` types each cut's `film` with it. */
export type FilmName = keyof typeof FILMS;

const NAMES = Object.keys(FILMS) as FilmName[];
/** Names that score several films at once. */
const GROUPS: Record<string, FilmName[]> = {
  release: ['release-en', 'release-zh'],
  all: NAMES,
};
const USAGE = `usage: node scripts/soundtrack.ts [${[...NAMES, ...Object.keys(GROUPS)].join('|')}]`;
const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

function isFilm(name: string): name is FilmName {
  return Object.hasOwn(FILMS, name);
}

/** The films the command line names, or exits with the usage line. */
function chosen(): FilmName[] {
  const [name = 'launch', ...rest] = process.argv.slice(2);
  if (rest.length === 0 && Object.hasOwn(GROUPS, name)) return GROUPS[name] ?? [];
  if (rest.length === 0 && isFilm(name)) return [name];
  console.error(`Unknown film "${process.argv.slice(2).join(' ')}"\n${USAGE}`);
  process.exit(2);
}

function scoreFilm(name: FilmName): void {
  const started = performance.now();
  const film: Film = FILMS[name];
  const { mix, music, effects, measured } = mixdown(film.seconds, film.score(), film.cues());
  const output = join(directory, film.track);
  mkdirSync(join(directory, 'stems'), { recursive: true });
  writeFileSync(output, wav(mix));
  for (const [stem, buses] of [
    ['music', music],
    ['effects', effects],
  ] as const) {
    writeFileSync(join(directory, 'stems', `${film.stems}${stem}.wav`), wav(buses));
  }
  console.log(
    `${name}: ${loudness(mix).toFixed(1)} LUFS (was ${measured.toFixed(1)}), peak ${peakDb(mix).toFixed(1)} dBFS, ` +
      `${((performance.now() - started) / 1000).toFixed(1)} s → ${output}`,
  );
}

for (const name of chosen()) scoreFilm(name);
