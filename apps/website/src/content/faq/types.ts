import type { Localized } from '../../i18n/routes.ts';
import type { FeatureSlug } from '../features/types.ts';

/**
 * One question on the `/faq` page, written per field so both languages always list the same
 * questions in the same order. Each is also emitted as a schema.org `Question`.
 */
export interface FaqEntry {
  /** The question's anchor, lowercase with dashes; the same in both languages. */
  id: string;
  question: Localized<string>;
  /** Plain-text paragraphs. */
  answer: Localized<readonly string[]>;
  /** The capability page that covers the answer in depth, linked after it. */
  see?: FeatureSlug;
}

/** A titled group of questions, an `h2` on the page. */
export interface FaqGroup {
  /** The group's anchor, lowercase with dashes. */
  id: string;
  title: Localized<string>;
  entries: readonly FaqEntry[];
}

/** One language's head and heading copy for `/faq`. */
export interface FaqPageCopy {
  headTitle: string;
  headDescription: string;
  title: string;
  lede: string;
}

export interface FaqPage {
  /** The last substantive content edit, `YYYY-MM-DD`. */
  updated: string;
  copy: Localized<FaqPageCopy>;
  groups: readonly FaqGroup[];
}
