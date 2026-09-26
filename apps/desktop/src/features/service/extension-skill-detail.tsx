import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { messageOf } from '../../lib/errors';
import { ExtensionDetailDialog, type DetailField } from './extension-detail-dialog';
import { SkillFiles } from './extension-skill-files';
import {
  asSkillDetail,
  skillSourceLabelKey,
  type ExtensionSkillDetail,
  type ExtensionSkillRow,
} from './extension-rows';

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
        <SkillFiles
          key={row.name}
          name={row.name}
          files={detail.files}
          truncated={detail.truncated}
        />
      ) : null}
    </ExtensionDetailDialog>
  );
}
