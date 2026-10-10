import type { Lang } from '../../copy.ts';

/** What the Open section shows inside the product's interface, per language. */
export const content = { en: {}, zh: {} } as const satisfies Record<Lang, unknown>;
