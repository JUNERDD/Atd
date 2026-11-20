import type { Localized } from '../../i18n/routes.ts';
import type { cases } from '../cases.ts';

/**
 * The capability pages, in the order the hub lists them. A slug is the page's URL segment in both
 * languages (`/features/computer-use`, `/zh/features/computer-use`) and must stay stable once
 * published, because search engines and other sites link to it.
 */
export const FEATURE_SLUGS = [
  'computer-use',
  'screen-capture',
  'selection-toolbar',
  'models',
  'mcp-and-skills',
  'automations',
  'apps',
  'privacy',
] as const;

export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

/** A homepage showcase illustration (`content/cases.ts`) that a capability page may reuse. */
export type CaseId = (typeof cases)[number]['id'];

/** One `h2` section of a capability page. */
export interface FeatureSection {
  /** The section's anchor, lowercase with dashes; the same in both languages. */
  id: string;
  title: string;
  /** Plain-text paragraphs, in order. */
  paragraphs: readonly string[];
  /** An optional plain-text bullet list after the paragraphs. */
  points?: readonly string[];
}

/** One question a capability page answers; also emitted as a schema.org `Question`. */
export interface FeatureQuestion {
  question: string;
  /** Plain text, one paragraph. */
  answer: string;
}

/** One language's copy of a capability page. */
export interface FeaturePageCopy {
  /** The capability's short name, used on cards, breadcrumbs and links ("Computer use"). */
  name: string;
  /** The hub card's one-sentence summary. */
  summary: string;
  /** The `<title>`: within about 60 characters in English or 30 in Chinese, ending in `— Atd`. */
  headTitle: string;
  /** The meta description: about 120–155 characters in English, at most 80 in Chinese. */
  headDescription: string;
  /** The page's `h1`, which names the capability in the words people search for. */
  title: string;
  /** One or two sentences under the `h1`. */
  lede: string;
  sections: readonly FeatureSection[];
  questions: readonly FeatureQuestion[];
  /** Search phrases describing the page, for schema.org `keywords`. */
  keywords: readonly string[];
}

/**
 * What illustrates a capability: the homepage showcase case that depicts it (`content/cases.ts`),
 * or, when none does, a scene of its own designed and exported like the showcase's — a 1440 × 900
 * transparent foreground at `public/cases/features/<lang>/<slug>.webp` over the shared backdrop —
 * with its description in each language. A scene stays off the homepage timeline.
 */
export type FeatureIllustration = { case: CaseId } | { scene: Localized<string> };

/** A capability page: its slug, sources, links and both languages' copy. */
export interface FeaturePage {
  slug: FeatureSlug;
  illustration: FeatureIllustration;
  /** The last substantive content edit, `YYYY-MM-DD`; drives sitemap `lastmod` and `dateModified`. */
  updated: string;
  /** Other capability pages the page links to at its end. */
  related: readonly FeatureSlug[];
  /** Release posts that introduced or changed the capability, by blog slug (`atd-0-11-0`). */
  posts: readonly string[];
  copy: Localized<FeaturePageCopy>;
}

/** One language's copy of the hub at `/features`. */
export interface FeaturesHubCopy {
  headTitle: string;
  headDescription: string;
  title: string;
  lede: string;
}

export interface FeaturesHub {
  /** The last substantive content edit, `YYYY-MM-DD`. */
  updated: string;
  copy: Localized<FeaturesHubCopy>;
}
