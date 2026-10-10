import type { FeatureId } from './copy';

/** A channel of the features display, in dots: the pictogram with a margin of unlit dots around it. */
const CHANNEL = { columns: 21, rows: 15 };

/**
 * Each capability's pictogram, 11 × 11 dots, top row first: `x` is a lit dot and `.` an unlit one.
 * Every icon keeps a one-dot stroke so the five read as one family.
 */
export const PICTOGRAMS: Record<FeatureId, readonly string[]> = {
  // A plug: a connection to whichever provider you bring.
  providers: [
    '...x...x...',
    '...x...x...',
    '...x...x...',
    '.xxxxxxxxx.',
    '.x.......x.',
    '.x.......x.',
    '..x.....x..',
    '...xxxxx...',
    '.....x.....',
    '.....x.....',
    '.....x.....',
  ],
  // Three blocks and a fourth being added.
  extensions: [
    'xxxxx.xxxxx',
    'x...x.x...x',
    'x...x.x...x',
    'x...x.x...x',
    'xxxxx.xxxxx',
    '...........',
    'xxxxx...x..',
    'x...x...x..',
    'x...x.xxxxx',
    'x...x...x..',
    'xxxxx...x..',
  ],
  // A memory chip: pins on every side and its die in the middle.
  memory: [
    '..x.x.x.x..',
    '.xxxxxxxxx.',
    'xx.......xx',
    '.x.......x.',
    'xx..xxx..xx',
    '.x..x.x..x.',
    'xx..xxx..xx',
    '.x.......x.',
    'xx.......xx',
    '.xxxxxxxxx.',
    '..x.x.x.x..',
  ],
  // A shield with a check mark.
  permissions: [
    'xxxxxxxxxxx',
    'x.........x',
    'x.........x',
    'x.......x.x',
    'x......x..x',
    'x.x...x...x',
    'x..x.x....x',
    '.x..x....x.',
    '..x.....x..',
    '...x...x...',
    '....xxx....',
  ],
  // A laptop running a prompt: all of it runs on your Mac.
  local: [
    '...........',
    '.xxxxxxxxx.',
    '.x.......x.',
    '.x.x.....x.',
    '.x..x....x.',
    '.x.x.xxx.x.',
    '.x.......x.',
    '.xxxxxxxxx.',
    '...........',
    'xxxxxxxxxxx',
    '...........',
  ],
};

/** Centers a pictogram on a channel's field of unlit dots. */
function onChannel(pictogram: readonly string[]): readonly string[] {
  const width = pictogram[0]?.length ?? 0;
  const left = '.'.repeat(Math.floor((CHANNEL.columns - width) / 2));
  const right = '.'.repeat(CHANNEL.columns - width - left.length);
  const top = Math.floor((CHANNEL.rows - pictogram.length) / 2);
  return Array.from({ length: CHANNEL.rows }, (_, y) => {
    const row = pictogram[y - top];
    return row === undefined ? '.'.repeat(CHANNEL.columns) : left + row + right;
  });
}

/** Each capability's channel, ready for the LED board. */
export const CHANNELS = {
  providers: onChannel(PICTOGRAMS.providers),
  extensions: onChannel(PICTOGRAMS.extensions),
  memory: onChannel(PICTOGRAMS.memory),
  permissions: onChannel(PICTOGRAMS.permissions),
  local: onChannel(PICTOGRAMS.local),
} satisfies Record<FeatureId, readonly string[]>;
