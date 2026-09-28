import { Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageOf } from '../../lib/errors';
import { lazyWithPreload } from '../../lib/lazy-with-preload';
import {
  ExtensionDetailFields,
  ExtensionDetailSection,
  ExtensionDetailStatus,
  type DetailField,
} from './extension-detail-fields';
import { ExtensionPage } from './extension-page';
import {
  asSkillDetail,
  skillSourceLabelKey,
  type ExtensionSkillDetail,
  type ExtensionSkillRow,
} from './extension-rows';
import { SkillBuiltinStatus } from './extension-skill-builtin';

// The file browser brings a tree, a diff renderer, and Markdown; the page starts loading them as
// it opens, alongside the skill's details, so the files usually render without a loading frame.
const { Component: SkillFiles, preload: preloadSkillFiles } = lazyWithPreload(() =>
  import('./extension-skill-files').then((module) => module.SkillFiles),
);

/** Holds the browser's fixed frame while its code loads, so the page does not jump. */
function SkillFilesFallback() {
  const { t } = useTranslation('settings');
  return (
    <ExtensionDetailSection label={t('extensions.detailFiles')} className="skill-files">
      <div className="skill-browser">
        <div className="skill-browser-tree" />
        <div className="skill-browser-preview">
          <output className="skill-browser-message">{t('extensions.detailLoading')}</output>
        </div>
      </div>
    </ExtensionDetailSection>
  );
}

type Loaded = { key: string; detail: ExtensionSkillDetail | null } | { key: string; error: string };

/**
 * Reads one skill's record and folder listing when its page opens, and again when the catalog
 * reports a new revision (an update or restore made since). A reply for an earlier skill or
 * revision is ignored.
 */
function useSkillDetail(name: string | null, revision: string): Loaded | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = name === null ? null : `${name}\n${revision}`;
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (name === null || key === null || !bridge) return;
    // The file browser renders once the details arrive; fetch its code meanwhile.
    void preloadSkillFiles();
    let active = true;
    bridge.skill(name).then(
      (result) => {
        if (active) setLoaded({ key, detail: asSkillDetail(result) });
      },
      (error: unknown) => {
        if (active) setLoaded({ key, error: messageOf(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [name, key]);
  return loaded?.key === key ? loaded : null;
}

/**
 * Edit with AI hands the skill to a panel session running create-skill, whose file tools may
 * write only under the product home catalog `<atdHome>/skills` (agent-service `service-fs.ts`
 * `confined`), which is exactly where `sourceKind: 'atd'` skills live, built-in copies included
 * (Restore brings a built-in back). Installed local, npm and Git copies and `~/.agents/skills`
 * are outside that root, so the session could not change them and the button stays hidden.
 */
function aiCanEdit(row: ExtensionSkillRow): boolean {
  return row.sourceKind === 'atd';
}

/**
 * One skill's details page: its state and built-in status, where it comes from, how a run may
 * load it, and its folder's files. Update and Restore stay in the row's More menu.
 */
export function SkillDetailPage({
  name,
  rows,
  connected,
  busy,
  onBack,
  onStartAi,
}: {
  name: string;
  rows: readonly ExtensionSkillRow[];
  connected: boolean;
  busy: boolean;
  onBack: () => void;
  onStartAi: () => void;
}) {
  const { t } = useTranslation('settings');
  const row = rows.find((item) => item.name === name) ?? null;
  const loaded = useSkillDetail(row ? row.name : null, row?.revision ?? '');
  const detail = loaded && 'detail' in loaded ? loaded.detail : null;
  // Rows arrive with the catalog; an empty catalog is still loading, a filled one lost the skill.
  const status = !row
    ? rows.length
      ? { text: t('extensions.detailMissing'), error: true }
      : { text: t('extensions.detailLoading'), error: false }
    : !loaded
      ? { text: t('extensions.detailLoading'), error: false }
      : 'error' in loaded
        ? { text: loaded.error, error: true }
        : detail
          ? null
          : { text: t('extensions.detailMissing'), error: true };
  const sourceKey = row?.system
    ? 'extensions.sourceSystem'
    : skillSourceLabelKey(row?.sourceKind ?? '');
  const fields: DetailField[] =
    row && detail
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
          ...(row.builtin
            ? [
                {
                  label: t('extensions.skillPage.builtin'),
                  value:
                    row.builtin.status === 'current' ? (
                      t('extensions.skillPage.builtinCurrent')
                    ) : (
                      <SkillBuiltinStatus status={row.builtin.status} />
                    ),
                },
              ]
            : []),
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
    <ExtensionPage
      label={t('extensions.skillPage.detailsLabel')}
      title={name}
      badge={
        row
          ? row.enabled
            ? { label: t('extensions.stateEnabled'), tone: 'on' }
            : { label: t('extensions.stateDisabled'), tone: 'off' }
          : null
      }
      description={row ? row.description || t('extensions.detailNoDescription') : undefined}
      backLabel={t('extensions.skillPage.back')}
      onBack={onBack}
      ai={
        row && aiCanEdit(row)
          ? { label: t('extensions.editWithAi'), disabled: busy || !connected, onClick: onStartAi }
          : null
      }
    >
      {status ? <ExtensionDetailStatus text={status.text} error={status.error} /> : null}
      <ExtensionDetailFields fields={fields} />
      {row && detail ? (
        <Suspense fallback={<SkillFilesFallback />}>
          {/* A new revision may list other files, so the tree starts over with it. */}
          <SkillFiles
            key={`${row.name}\n${row.revision}`}
            name={row.name}
            files={detail.files}
            truncated={detail.truncated}
          />
        </Suspense>
      ) : null}
    </ExtensionPage>
  );
}
