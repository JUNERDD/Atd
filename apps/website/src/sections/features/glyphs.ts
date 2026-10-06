/**
 * The feature pictograms: one 9 × 9 dot-matrix bitmap per tile, top row first. `x` is a lit dot and
 * `.` an unlit one; every icon keeps a one-dot stroke so the family reads as one set.
 */
export const FEATURE_IDS = [
  'conversations',
  'composer',
  'tools',
  'permissions',
  'providers',
  'commands',
  'extensions',
  'memory',
  'languages',
  'updates',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export const glyphs: Record<FeatureId, readonly string[]> = {
  // A speech bubble with a typing ellipsis.
  conversations: [
    '.xxxxxxx.',
    'x.......x',
    'x.......x',
    'x.x.x.x.x',
    'x.......x',
    'x.......x',
    '.xxxxxxx.',
    '..xx.....',
    '..x......',
  ],
  // The @ that mentions a file.
  composer: [
    '..xxxxx..',
    '.x.....x.',
    'x..xxx..x',
    'x.x..x..x',
    'x.x..x..x',
    'x..xx.xx.',
    'x........',
    '.x.....x.',
    '..xxxxx..',
  ],
  // A terminal window with a prompt.
  tools: [
    '.........',
    'xxxxxxxxx',
    'x.......x',
    'x.x.....x',
    'x..x....x',
    'x.x.....x',
    'x...xxx.x',
    'x.......x',
    'xxxxxxxxx',
  ],
  // A shield with a check mark.
  permissions: [
    'xxxxxxxxx',
    'x.......x',
    'x.....x.x',
    'x....x..x',
    'x.x.x...x',
    'x..x....x',
    '.x.....x.',
    '..x...x..',
    '...xxx...',
  ],
  // A plug: a connection to a model provider.
  providers: [
    '..x...x..',
    '..x...x..',
    'xxxxxxxxx',
    'x.......x',
    'x.......x',
    '.x.....x.',
    '..xxxxx..',
    '....x....',
    '....x....',
  ],
  // A key with a slash on it.
  commands: [
    '.xxxxxxx.',
    'x.......x',
    'x.....x.x',
    'x....x..x',
    'x...x...x',
    'x..x....x',
    'x.x.....x',
    'x.......x',
    '.xxxxxxx.',
  ],
  // Three blocks and a fourth being added.
  extensions: [
    '.........',
    '.xxx.xxx.',
    '.xxx.xxx.',
    '.xxx.xxx.',
    '.........',
    '.xxx..x..',
    '.xxx.xxx.',
    '.xxx..x..',
    '.........',
  ],
  // A memory chip.
  memory: [
    '..x.x.x..',
    '.xxxxxxx.',
    'xx.....xx',
    '.x.xxx.x.',
    'xx.x.x.xx',
    '.x.xxx.x.',
    'xx.....xx',
    '.xxxxxxx.',
    '..x.x.x..',
  ],
  // A globe.
  languages: [
    '..xxxxx..',
    '.x..x..x.',
    'x..x.x..x',
    'x..x.x..x',
    'xxxxxxxxx',
    'x..x.x..x',
    'x..x.x..x',
    '.x..x..x.',
    '..xxxxx..',
  ],
  // An arrow coming down into a tray: an update installing itself.
  updates: [
    '....x....',
    '....x....',
    '....x....',
    '.x..x..x.',
    '..x.x.x..',
    '...xxx...',
    '....x....',
    'x.......x',
    'xxxxxxxxx',
  ],
};
