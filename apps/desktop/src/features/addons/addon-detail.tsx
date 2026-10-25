import { useTranslation } from 'react-i18next';
import type { AddonView } from '@atd/agent-contracts';
import { Progress } from '@atd/ui/components/progress';
import { Spinner } from '@atd/ui/components/spinner';
import { progressPercent, type AddonState } from './addon-state';
import { formatBytes } from './format-bytes';

/**
 * The line under an add-on's description: what is true of it now. While the service works on it
 * the line is a status (`<output>`, so the progress is announced) with a spinner, and a download
 * with a known size draws its bar below.
 */
export function AddonDetail({
  state,
  addon,
  loadError,
}: {
  state: AddonState;
  addon: AddonView | null;
  /** The list could not be read and nothing is cached. */
  loadError: string | null;
}) {
  const { t, i18n } = useTranslation('addons');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const size = (bytes: number) => formatBytes(bytes, language);

  if (!addon) {
    return loadError ? <DetailText>{t('detail.loadFailed')}</DetailText> : null;
  }
  switch (state) {
    case 'unavailable':
      return <DetailText>{t('detail.unavailable')}</DetailText>;
    case 'installed':
      return (
        <DetailText>
          {t('detail.installed', { version: addon.installed?.version ?? addon.version })}
        </DetailText>
      );
    case 'outdated': {
      const versions = { installed: addon.outdated?.version, version: addon.version };
      return (
        <DetailText>
          {addon.size === undefined
            ? t('detail.outdated', versions)
            : t('detail.outdatedSize', { ...versions, size: size(addon.size) })}
        </DetailText>
      );
    }
    case 'notInstalled':
      return addon.size === undefined ? null : (
        <DetailText>{t('detail.size', { size: size(addon.size) })}</DetailText>
      );
    case 'working':
      return <AddonWorking addon={addon} size={size} />;
    case 'loading':
      return null;
  }
}

function DetailText({ children }: { children: string }) {
  return <p className="min-w-0 text-xs text-muted-foreground">{children}</p>;
}

function AddonWorking({ addon, size }: { addon: AddonView; size: (bytes: number) => string }) {
  const { t } = useTranslation('addons');
  const updating = Boolean(addon.outdated);
  const percent = progressPercent(addon);
  const progress = addon.progress;
  let status: string;
  switch (addon.phase) {
    case 'downloading':
      if (progress && percent !== null) {
        const amounts = { received: size(progress.received), total: size(progress.total) };
        status = updating
          ? t('status.updatingDownload', amounts)
          : t('status.downloading', amounts);
      } else {
        status = updating ? t('status.updating') : t('status.downloadingUnknown');
      }
      break;
    case 'verifying':
      status = t('status.verifying');
      break;
    case 'removing':
      status = t('status.removing');
      break;
    case 'installing':
    case 'idle':
      status = updating ? t('status.updating') : t('status.installing');
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <output className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <Spinner className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{status}</span>
      </output>
      {addon.phase === 'downloading' && percent !== null && (
        <Progress value={percent} aria-label={status} />
      )}
    </div>
  );
}
