/**
 * The feature pictograms: one 9 × 9 dot-matrix bitmap per cell, top row first. `x` is a lit dot and
 * `.` an unlit one; every icon keeps a one-dot stroke so the family reads as one set.
 */
export const FEATURE_IDS = ['providers', 'extensions', 'memory', 'permissions'] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];

export const glyphs: Record<FeatureId, readonly string[]> = {
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
};
