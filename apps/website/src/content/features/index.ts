import { computerUse } from './computer-use.ts';
import { screenCapture } from './screen-capture.ts';
import { selectionToolbar } from './selection-toolbar.ts';
import { models } from './models.ts';
import { mcpAndSkills } from './mcp-and-skills.ts';
import { automations } from './automations.ts';
import { apps } from './apps.ts';
import { privacy } from './privacy.ts';
import { FEATURE_SLUGS, type FeaturePage, type FeatureSlug } from './types.ts';

export { featuresHub } from './hub.ts';
export * from './types.ts';

/**
 * Every capability page, in the hub's order. The modules are plain TypeScript with `.ts` import
 * extensions so the prerender scripts can read them under Node's type stripping.
 */
export const featurePages: readonly FeaturePage[] = [
  computerUse,
  screenCapture,
  selectionToolbar,
  models,
  mcpAndSkills,
  automations,
  apps,
  privacy,
];

if (featurePages.map((page) => page.slug).join() !== FEATURE_SLUGS.join())
  throw new Error('featurePages must list every FEATURE_SLUGS entry, in order.');

export function isFeatureSlug(value: string): value is FeatureSlug {
  return FEATURE_SLUGS.some((slug) => slug === value);
}

/** The capability page with this slug, or `undefined` when there is none. */
export function featurePage(slug: string): FeaturePage | undefined {
  return featurePages.find((page) => page.slug === slug);
}
