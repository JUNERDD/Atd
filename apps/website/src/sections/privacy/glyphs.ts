import type { KeptId } from './copy';

/** 7 × 7 pictograms in the features' dot-matrix family, one per line of the board. */
export const glyphs: Record<KeptId | 'task', readonly string[]> = {
  // A speech bubble.
  history: ['xxxxxxx', 'x.....x', 'x.xxx.x', 'x.....x', 'xxxxxxx', 'xx.....', 'x......'],
  // Two sheets, one behind the other.
  memory: ['..xxxxx', '..x...x', 'xxxxx.x', 'x...x.x', 'x...xxx', 'x...x..', 'xxxxx..'],
  // Two sliders.
  setup: ['.x.....', 'xxxxxxx', '.x.....', '.......', '....x..', 'xxxxxxx', '....x..'],
  // A key.
  keys: ['.......', '.......', 'xxx....', 'x.xxxxx', 'xxx..xx', '.......', '.......'],
  // A chip.
  model: ['.x.x.x.', 'xxxxxxx', '.x...x.', 'xx.x.xx', '.x...x.', 'xxxxxxx', '.x.x.x.'],
  // A sealed envelope.
  task: ['.......', 'xxxxxxx', 'xx...xx', 'x.x.x.x', 'x..x..x', 'xxxxxxx', '.......'],
};
