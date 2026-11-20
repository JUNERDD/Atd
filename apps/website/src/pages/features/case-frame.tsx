import { caseBackdrop, caseImage, cases } from '../../content/cases';
import type { FeaturePage } from '../../content/features';
import { mediaUrl } from '../../content/media';
import type { Lang } from '../../i18n/routes';

/** The capability's transparent foreground in `lang`, and what it shows. */
function foreground(page: FeaturePage, lang: Lang): { src: string; alt: string } {
  const { illustration } = page;
  if ('scene' in illustration)
    return {
      src: mediaUrl(`/cases/features/${lang}/${page.slug}.webp`),
      alt: illustration.scene[lang],
    };
  const item = cases.find((candidate) => candidate.id === illustration.case);
  // Case ids are derived from `cases`, so every one resolves.
  if (!item) throw new Error(`Unknown showcase case: ${illustration.case}`);
  return { src: caseImage(item.id, lang), alt: item.alt[lang] };
}

/**
 * A capability's illustration composed as the homepage's showcase composes it: the shared,
 * stationary backdrop under a transparent foreground in the page's language — the showcase case
 * that depicts the capability, or its own scene. Both layers are 1440 × 900, the 16:10 of the
 * `.case-frame` box they fill, so the box is reserved before either loads. The foreground carries
 * its description, unless `decorative` because the surrounding text already names what it shows
 * (a card that is one link).
 */
export function IllustrationLayers({
  page,
  lang,
  lazy,
  decorative,
}: {
  page: FeaturePage;
  lang: Lang;
  /** Below the fold: let the browser defer both layers. */
  lazy: boolean;
  decorative: boolean;
}) {
  const loading = lazy ? 'lazy' : undefined;
  const { src, alt } = foreground(page, lang);
  return (
    <>
      <img
        className="case-frame__layer"
        src={caseBackdrop}
        width={1440}
        height={900}
        alt=""
        loading={loading}
        decoding="async"
        draggable={false}
      />
      <img
        className="case-frame__layer"
        src={src}
        width={1440}
        height={900}
        alt={decorative ? '' : alt}
        loading={loading}
        decoding="async"
        draggable={false}
      />
    </>
  );
}
