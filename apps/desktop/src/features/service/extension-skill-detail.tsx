import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageOf } from '../../lib/errors';
import { lazyWithPreload } from '../../lib/lazy-with-preload';
import { ExtensionDetailDialog, type DetailField } from './extension-detail-dialog';
import {
  asSkillDetail,
  skillSourceLabelKey,
  type ExtensionSkillDetail,
  type ExtensionSkillRow,
} from './extension-rows';

// The file browser brings a tree, a diff renderer, and Markdown; the dialog starts loading them as
// it opens, alongside the skill's details, so the files usually render without a loading frame.
const { Component: SkillFiles, preload: preloadSkillFiles } = lazyWithPreload(() =>
  import('./extension-skill-files').then((module) => module.SkillFiles),
);

/** Holds the browser's fixed frame while its code loads, so the dialog does not resize. */
function SkillFilesFallback() {
  const { t } = useTranslation('settings');
  return (
    <section
      className="extension-detail-section skill-files"
      aria-label={t('extensions.detailFiles')}
    >
      <h3>{t('extensions.detailFiles')}</h3>
      <div className="skill-browser">
        <div className="skill-browser-tree" />
        <div className="skill-browser-preview">
          <output className="skill-browser-message">{t('extensions.detailLoading')}</output>
        </div>
      </div>
    </section>
  );
}

type Loaded =
  | { name: string; detail: ExtensionSkillDetail | null }
  | { name: string; error: string };

/**
 * Reads one skill's record and folder listing each time its details open, so an update or restore made
 * since shows. A reply for another skill, or for a dialog that closed, is ignored.
 */
function useSkillDetail(name: string | null): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!name || !bridge) return;
    // The file browser renders once the details arrive; fetch its code meanwhile.
    void preloadSkillFiles();
    let active = true;
    bridge.skill(name).then(
      (result) => {
        if (active) setLoaded({ name, detail: asSkillDetail(result) });
      },
      (error: unknown) => {
        if (active) setLoaded({ name, error: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [name]);
  return loaded?.name === name ? loaded : null;
}

/** Skill details: where it comes from, how a run may load it, and its folder's files. */
export function SkillDetailDialog({
  row,
  open,
  onOpenChange,
}: {
  row: ExtensionSkillRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  const loaded = useSkillDetail(open ? row.name : null);
  const sourceKey = row.system ? 'extensions.sourceSystem' : skillSourceLabelKey(row.sourceKind);
  const detail = loaded && 'detail' in loaded ? loaded.detail : null;
  const status = !loaded
    ? { text: t('extensions.detailLoading'), error: false }
    : 'error' in loaded
      ? { text: loaded.error, error: true }
      : detail
        ? null
        : { text: t('extensions.detailMissing'), error: true };
  const fields: DetailField[] = detail
    ? [
        {
          label: t('extensions.detailSource'),
          // A package or repository says more than the label; a path repeats the location below.
          value: [
            sourceKey ? t(sourceKey) : '',
            row.sourceKind === 'npm' || row.sourceKind === 'git' ? detail.source : '',
          ]
            .filter(Boolean)
            .join(' · '),
        },
        ...(row.revision
          ? [{ label: t('extensions.detailRevision'), value: row.revision, mono: true }]
          : []),
        { label: t('extensions.detailLocation'), value: detail.baseDir, mono: true },
        {
          label: t('extensions.detailInvocation'),
          value: detail.disableModelInvocation
            ? t('extensions.invocationUser')
            : t('extensions.invocationModel'),
        },
        ...(detail.capability.tools.length
          ? [{ label: t('extensions.detailTools'), value: detail.capability.tools.join(', ') }]
          : []),
        ...(detail.license
          ? [{ label: t('extensions.detailLicense'), value: detail.license }]
          : []),
      ]
    : [];
  return (
    <ExtensionDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={row.name}
      description={row.description || t('extensions.detailNoDescription')}
      badge={
        row.enabled
          ? { label: t('extensions.stateEnabled'), tone: 'on' }
          : { label: t('extensions.stateDisabled'), tone: 'off' }
      }
      wide
      fields={fields}
      status={status}
    >
      {detail ? (
        <Suspense fallback={<SkillFilesFallback />}>
          <SkillFiles
            key={row.name}
            name={row.name}
            files={detail.files}
            truncated={detail.truncated}
          />
        </Suspense>
      ) : null}
    </ExtensionDetailDialog>
  );
}
