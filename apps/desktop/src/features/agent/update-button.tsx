import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Spinner } from '@atd/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import type { AppUpdateState } from '../../client/contract';
import { IconButton } from '../../components/icon-button';
import './update-button.css';

/**
 * The header's app update, shown only while one is under way. A download shows how far it got as
 * a ring, or a spinner while its size is unknown; preparing the download shows a spinner. The
 * percent is not shown, only spoken: the accessible name carries it, the tooltip names the version.
 * Either opens the shell's own update window, with the details and Cancel. A ready update becomes
 * the restart into it, which the shell runs through its quit flow, so running tasks still get
 * their confirmation.
 */
export function UpdateButton() {
  const { t } = useTranslation('panel');
  const [update, setUpdate] = useState<AppUpdateState>({ phase: 'idle' });
  useEffect(() => window.desktop?.update?.onState(setUpdate), []);
  if (update.phase === 'idle') return null;
  if (update.phase === 'ready')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" onClick={() => window.desktop?.update?.install()}>
            {t('header.update')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {t('header.updateTooltip', { version: update.version })}
        </TooltipContent>
      </Tooltip>
    );
  const { version } = update;
  const percent = update.phase === 'downloading' ? update.percent : null;
  const label =
    update.phase === 'downloading'
      ? t('header.updateDownloading', { version })
      : t('header.updatePreparing', { version });
  return (
    <IconButton
      label={label}
      aria-label={
        percent === null ? label : t('header.updateDownloadingPercent', { version, percent })
      }
      variant="glass-ghost"
      className="header-button text-muted-foreground"
      onClick={() => window.desktop?.update?.show()}
    >
      {percent === null ? (
        <Spinner />
      ) : (
        <svg className="update-progress-ring size-4" viewBox="0 0 24 24" aria-hidden>
          <circle className="update-progress-track" cx="12" cy="12" r="9" />
          {percent > 0 && (
            <circle
              className="update-progress-value"
              cx="12"
              cy="12"
              r="9"
              pathLength={100}
              strokeDasharray={`${percent} 100`}
            />
          )}
        </svg>
      )}
    </IconButton>
  );
}
