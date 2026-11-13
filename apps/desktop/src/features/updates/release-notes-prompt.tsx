import { FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { IconButton } from '../../components/icon-button';
import { showErrorToast } from '../../components/toast-store';
import { openReleaseNotes } from './release-notes';
import { useReleaseNotesShown } from './use-release-notes';

/**
 * The installed release's prompt occupies the update slot only while no update is under way. Its
 * button is the update button itself (same variant, size, states and tooltip), so the two read as
 * one control. Dismissal is a separate badge on the button's corner that hover or keyboard focus
 * reveals (`update-button.css`); it never resizes or moves the button.
 */
export function ReleaseNotesPrompt({ version, url }: { version: string; url: string }) {
  const { t } = useTranslation('panel');
  useReleaseNotesShown(version);
  const label = t('header.releaseNotesTooltip', { version });

  return (
    <div className="release-notes-prompt relative shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="sm"
            className="release-notes-button"
            aria-label={label}
            onClick={() => void openReleaseNotes(version, url).catch(showErrorToast)}
          >
            <FileText className="release-notes-icon" aria-hidden />
            <span className="release-notes-label">{t('header.releaseNotes')}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <IconButton
        variant="default"
        size="icon-xs"
        className="release-notes-dismiss absolute -top-1.5 -right-1.5 size-5 border-2 border-background bg-foreground text-background hover:bg-foreground/80"
        label={t('header.dismissReleaseNotes')}
        tooltip={false}
        onClick={() => window.desktop?.update?.dismissReleaseNotes(version)}
      >
        <X className="size-3.5" strokeWidth={2.5} aria-hidden />
      </IconButton>
    </div>
  );
}
