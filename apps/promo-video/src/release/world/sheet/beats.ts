/** The world sheet's beats, in sheet seconds (pure, so pages and any probe share them). */
import { beats } from '../../timeline.ts';

/** Keystrokes and the retype, in sheet seconds. */
export const TYPE_PAGE = {
  type: 0.3,
  select: 1.5,
  replace: beats(3.5),
  zh: 0.6,
} as const;

/** The statement page's beats, in sheet seconds. */
export const STATEMENT_PAGE = { title: 3.75, line: 4.35, zh: 4.95, out: 6.0 } as const;

/** The stage page's beats, in sheet seconds. */
export const STAGE_PAGE = { push: 7.05, click: 7.65, type: 7.8, land: 8.7 } as const;
