import { useTranslation } from 'react-i18next';
import { Skeleton } from '@atd/ui/components/skeleton';
import {
  LoadingPlaceholder,
  TextPlaceholder,
  type LineWidth,
} from '../../components/loading-placeholder';
import {
  ExtensionDetailFieldsPlaceholder,
  ExtensionDetailSection,
  LabelPlaceholder,
} from './extension-detail-fields';

/** A folder and its files, then a second folder: rows of the tree at their depth and length. */
const TREE_ROWS: readonly { nested: boolean; width: LineWidth }[] = [
  { nested: false, width: 'half' },
  { nested: true, width: 'threeFifths' },
  { nested: true, width: 'twoFifths' },
  { nested: false, width: 'third' },
  { nested: true, width: 'half' },
];

/** Lines of a file's text, of varying length like a paragraph's. */
const PREVIEW_LINES: readonly LineWidth[] = [
  'twoFifths',
  'full',
  'fourFifths',
  'full',
  'twoThirds',
  'threeQuarters',
];

/**
 * The open file's text while it loads (inside `LoadingPlaceholder`), at the preview's 12px inset
 * and its 20px lines.
 */
export function SkillPreviewPlaceholder() {
  return (
    <div className="flex flex-col p-3">
      {PREVIEW_LINES.map((width, index) => (
        <TextPlaceholder key={index} width={width} />
      ))}
    </div>
  );
}

/**
 * The file browser's frame while its code or the skill loads: the tree's 30px rows (the tree's
 * default density) with an icon and a name, beside the path bar and the file's lines, at the
 * browser's fixed height, so the real browser takes its place without moving the page.
 */
function SkillBrowserPlaceholder() {
  return (
    <div className="skill-browser">
      <div className="skill-browser-tree">
        {TREE_ROWS.map(({ nested, width }, index) => (
          <div
            key={index}
            className={
              nested
                ? 'flex h-7.5 items-center gap-2 pr-2 pl-7'
                : 'flex h-7.5 items-center gap-2 px-2'
            }
          >
            <Skeleton className="size-4 shrink-0 rounded-md" />
            <Skeleton data-width={width} className="line-placeholder h-3 rounded-full" />
          </div>
        ))}
      </div>
      <div className="skill-browser-preview">
        <div className="skill-browser-path">
          <TextPlaceholder width="quarter" />
        </div>
        <SkillPreviewPlaceholder />
      </div>
    </div>
  );
}

/** Holds the browser's fixed frame while its code loads, so the page does not jump. */
export function SkillFilesFallback() {
  const { t } = useTranslation('settings');
  return (
    <ExtensionDetailSection label={t('extensions.detailFiles')} className="skill-files">
      <LoadingPlaceholder label={t('extensions.detailLoading')}>
        <SkillBrowserPlaceholder />
      </LoadingPlaceholder>
    </ExtensionDetailSection>
  );
}

/**
 * A skill's details page while the skill is read: its facts, then the Files section with the
 * browser's frame, in the page's 20px rhythm.
 */
export function SkillDetailPlaceholder() {
  const { t } = useTranslation('settings');
  return (
    <LoadingPlaceholder label={t('extensions.detailLoading')} className="gap-5">
      <ExtensionDetailFieldsPlaceholder count={5} />
      <div className="extension-detail-section skill-files">
        <LabelPlaceholder />
        <SkillBrowserPlaceholder />
      </div>
    </LoadingPlaceholder>
  );
}
