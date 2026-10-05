import {
  Brain,
  Check,
  Copy,
  Ellipsis,
  FileDown,
  GitFork,
  RefreshCw,
  Share,
  Square,
  TextQuote,
  Volume2,
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import type { TaskRun } from '../../../client/agent/task-schema';
import { IconButton } from '../../../components/icon-button';
import type { AdaptedTurn } from './adapter';
import { showErrorToast } from '../../../components/toast-store';
import { CommandMenuItems } from './command-menu-items';
import { speakableText } from './turn-markdown';
import { useCopyFeedback } from './use-copy-feedback';
import { useTurnActions } from './use-turn-actions';
import { useTurnSpeech } from './use-turn-speech';

/**
 * The action bar that closes a settled turn, below everything the turn shows (tool activity, a
 * stop note and approval banners included): Copy for the final answer `answer`, Regenerate on the
 * task's last turn, Read aloud, Fork, and a More menu with the exports, Share and Remember, then
 * the commands placed on turn actions, which run on the answer. Only what applies is listed, and
 * nothing renders when nothing does. The last turn's bar always shows; an earlier turn's appears
 * on hover or keyboard focus (`data-reveal`) in space it always keeps.
 */
export function TurnActions({
  turn,
  run,
  answer,
  last,
}: {
  turn: AdaptedTurn;
  /** The run whose prompt opens the turn, if the transcript knows it. */
  run: TaskRun | undefined;
  answer: string;
  last: boolean;
}) {
  const { t } = useTranslation('tasks');
  const copy = useCopyFeedback();
  const actions = useTurnActions(turn, run, answer, last);
  const { regenerate, fork, copyMarkdown, saveMarkdown, remember, commands, runCommand } = actions;
  const moreButton = useRef<HTMLButtonElement>(null);
  const speech = useTurnSpeech(turn.id, answer ? speakableText(answer) : '');
  const canShare = Boolean(answer && window.desktop?.share);
  // The share picker points at More, which opened the menu that chose it (closed by then). Not the
  // bar: it spans the transcript's width, so the picker would center far right of the buttons.
  function share() {
    const rect = moreButton.current?.getBoundingClientRect();
    const anchor = rect
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : { x: 0, y: 0, width: 0, height: 0 };
    window.desktop?.share?.(answer, anchor).catch(showErrorToast);
  }
  const builtIn = copyMarkdown || saveMarkdown || canShare || remember;
  const more = builtIn || commands.length > 0;
  if (!answer && !regenerate && !speech && !fork && !more) return null;

  return (
    <div
      className="message-actions"
      data-reveal={last ? undefined : 'hover'}
      data-pinned={copy.pinned || undefined}
    >
      {answer && (
        <IconButton
          label={copy.copied ? t('conversation.copied') : t('conversation.copy')}
          aria-label={t('conversation.copyResponseLabel')}
          tooltipPinned={copy.pinned}
          onPointerLeave={copy.unpin}
          onClick={() => void copy.copy(answer)}
        >
          {copy.copied ? <Check /> : <Copy />}
        </IconButton>
      )}
      {regenerate && (
        <IconButton
          label={t('turnActions.regenerate')}
          disabled={actions.pending}
          onClick={() => void regenerate()}
        >
          <RefreshCw />
        </IconButton>
      )}
      {speech && (
        <IconButton
          label={speech.reading ? t('turnActions.stopReading') : t('turnActions.readAloud')}
          onClick={() => void speech.toggle().catch(showErrorToast)}
        >
          {speech.reading ? <Square /> : <Volume2 />}
        </IconButton>
      )}
      {fork && (
        <IconButton
          label={t('turnActions.fork')}
          disabled={actions.pending}
          onClick={() => void fork()}
        >
          <GitFork />
        </IconButton>
      )}
      {more && (
        <DropdownMenu>
          <DropdownMenuTrigger ref={moreButton} asChild>
            <IconButton label={t('turnActions.more')} tooltipDismissOnClick>
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="start">
            {copyMarkdown && (
              <DropdownMenuItem disabled={actions.pending} onSelect={() => void copyMarkdown()}>
                <TextQuote />
                {t('turnActions.copyMarkdown')}
              </DropdownMenuItem>
            )}
            {saveMarkdown && (
              <DropdownMenuItem disabled={actions.pending} onSelect={() => void saveMarkdown()}>
                <FileDown />
                {t('turnActions.saveMarkdown')}
              </DropdownMenuItem>
            )}
            {canShare && (
              <DropdownMenuItem onSelect={share}>
                <Share />
                {t('turnActions.share')}
              </DropdownMenuItem>
            )}
            {remember && (
              <DropdownMenuItem onSelect={remember}>
                <Brain />
                {t('turnActions.remember')}
              </DropdownMenuItem>
            )}
            {commands.length > 0 && (
              <>
                {builtIn && <DropdownMenuSeparator />}
                <CommandMenuItems
                  commands={commands}
                  onRun={(command) => runCommand(command, moreButton.current)}
                />
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
