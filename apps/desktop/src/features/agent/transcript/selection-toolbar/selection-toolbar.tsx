import { Brain, Check, Copy, Ellipsis, Square, TextQuote, Volume2 } from 'lucide-react';
import { useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuoteSource } from '@atd/agent-contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { Popover, PopoverAnchor, PopoverContent } from '@atd/ui/components/popover';
import { Toolbar, ToolbarButton } from '@atd/ui/components/toolbar';
import { IconButton } from '../../../../components/icon-button';
import { showErrorToast } from '../../../../components/toast-store';
import { CommandMenuItems } from '../command-menu-items';
import { useCopyFeedback } from '../use-copy-feedback';
import { useOfferedCommands, type CommandOpener } from '../use-offered-commands';
import { useTurnSpeech } from '../use-turn-speech';
import { quoteSource } from './quote-source';
import { selectionMarkdown } from './selection-markdown';
import { TOOLBAR, useMessageSelection, type MessageSelection } from './use-message-selection';

/** The read-aloud key of a selection, apart from every turn's own; one selection reads at a time. */
const SELECTION_SPEECH = 'selection';

/** Keeps focus, and with it the page's selection, where it is. */
function keep(event: Event | SyntheticEvent) {
  event.preventDefault();
}

/**
 * Actions on text or elements selected in settled assistant messages under `root`: Quote in
 * reply, Copy, Read aloud and Remember, then More with the commands placed on this toolbar, beside
 * where the selection ends. The toolbar never takes focus, so the selection stays visible and
 * editable while it shows (its command menu does, and keeps the selection); once a keyboard
 * reaches it, it is one tab stop whose arrow keys move between the actions. Quote, Copy, Remember
 * and the commands carry the selection as Markdown (a code block it touches whole); reading aloud
 * takes the text as selected.
 */
export function SelectionToolbar({
  root,
  onQuote,
  onRemember,
  onCommand,
}: {
  root: HTMLElement | null;
  /**
   * Adds the selection's Markdown to the reply draft as a quote, with where it was taken from;
   * without it there is no Quote.
   */
  onQuote?: ((markdown: string, source: QuoteSource | undefined) => void) | undefined;
  /** Starts a memory session seeded with the selection; without it the toolbar offers no Remember. */
  onRemember?: ((text: string) => void) | undefined;
  /**
   * Opens a command placed on this toolbar on the selection; without it the toolbar offers no
   * commands. The toolbar closes as its choice clears the selection, so focus has no origin here.
   */
  onCommand?: CommandOpener | undefined;
}) {
  const { t } = useTranslation('tasks');
  const { selection, dismiss } = useMessageSelection(root);
  // The last selection stays the anchor while the toolbar closes, so it fades where it was.
  const [shown, setShown] = useState<MessageSelection | null>(selection);
  if (selection && selection !== shown) setShown(selection);
  const anchor = useMemo(() => shown && { current: shown.anchor }, [shown]);
  // Tooltips open away from the selection too, so they never cover the text the actions take.
  const side = shown?.side ?? 'top';
  const copy = useCopyFeedback();
  const speech = useTurnSpeech(SELECTION_SPEECH, shown?.text ?? '');
  const offered = useOfferedCommands('turnSelection');
  const commands = onCommand ? offered : [];
  /** The command menu is open, so focus moving into it must not cost the toolbar its selection. */
  const menuOpen = useRef(false);
  /** A keyboard opened the command menu from the toolbar it had reached, so focus goes back there. */
  const menuFromKeyboard = useRef(false);

  /** The selected parts of each message as Markdown, apart as paragraphs; activity between drops. */
  async function markdown() {
    if (!shown) return null;
    try {
      const parts = await Promise.all(shown.parts.map(({ range }) => selectionMarkdown(range)));
      return parts.filter(Boolean).join('\n\n');
    } catch (error) {
      showErrorToast(error);
      return null;
    }
  }
  /** Ends with the selection cleared, which closes the toolbar. */
  async function handOff(take: (text: string) => void) {
    const text = await markdown();
    if (!text) return;
    take(text);
    document.getSelection()?.removeAllRanges();
  }
  async function copySelection() {
    const text = await markdown();
    if (text) await copy.copy(text);
  }
  /**
   * Radix focuses the open command menu, then the row under the pointer or the arrow keys, and a
   * focus change can clear the page's selection (WebKit does) before the focus event, which would
   * close the toolbar. Selecting its range again in that event keeps both, with nothing painted
   * between. A closing menu is left alone: a chosen command has just taken the selection.
   */
  function keepSelection() {
    const page = document.getSelection();
    if (!menuOpen.current || !shown || !page?.isCollapsed) return;
    page.removeAllRanges();
    page.addRange(shown.range.cloneRange());
  }

  return (
    <Popover
      open={selection !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      {anchor && <PopoverAnchor virtualRef={anchor} />}
      <PopoverContent
        data-selection-toolbar
        side={side}
        sideOffset={8}
        hideWhenDetached
        className="min-w-0 rounded-full p-1"
        onOpenAutoFocus={keep}
        onCloseAutoFocus={keep}
        onMouseDown={keep}
      >
        <Toolbar aria-label={t('selection.toolbar')}>
          {onQuote && (
            <ToolbarButton asChild>
              <IconButton
                label={t('selection.quote')}
                variant="glass-ghost"
                tooltipSide={side}
                onClick={() => {
                  // Read before the hand-off clears the selection and the composer takes focus.
                  const source = shown ? quoteSource(shown.parts) : undefined;
                  void handOff((text) => onQuote(text, source));
                }}
              >
                <TextQuote />
              </IconButton>
            </ToolbarButton>
          )}
          <ToolbarButton asChild>
            <IconButton
              label={copy.copied ? t('conversation.copied') : t('conversation.copy')}
              variant="glass-ghost"
              tooltipSide={side}
              tooltipPinned={copy.pinned}
              onPointerLeave={copy.unpin}
              onClick={() => void copySelection()}
            >
              {copy.copied ? <Check /> : <Copy />}
            </IconButton>
          </ToolbarButton>
          {speech && (
            <ToolbarButton asChild>
              <IconButton
                label={speech.reading ? t('turnActions.stopReading') : t('turnActions.readAloud')}
                variant="glass-ghost"
                tooltipSide={side}
                onClick={() => void speech.toggle().catch(showErrorToast)}
              >
                {speech.reading ? <Square /> : <Volume2 />}
              </IconButton>
            </ToolbarButton>
          )}
          {onRemember && (
            <ToolbarButton asChild>
              <IconButton
                label={t('turnActions.remember')}
                variant="glass-ghost"
                tooltipSide={side}
                onClick={() => void handOff(onRemember)}
              >
                <Brain />
              </IconButton>
            </ToolbarButton>
          )}
          {/* Not modal: a modal menu blocks presses outside it, so pressing More again or another
              action would land on the page and drop the selection that keeps the toolbar open. */}
          {commands.length > 0 && (
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => {
                menuOpen.current = open;
                if (open)
                  menuFromKeyboard.current = Boolean(document.activeElement?.closest(TOOLBAR));
              }}
            >
              <ToolbarButton asChild>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    label={t('turnActions.more')}
                    variant="glass-ghost"
                    tooltipSide={side}
                    tooltipDismissOnClick
                  >
                    <Ellipsis />
                  </IconButton>
                </DropdownMenuTrigger>
              </ToolbarButton>
              {/* Portaled out of the toolbar, so it carries the toolbar's mark, and presses in it
                  keep focus and the selection where they are. Closing returns focus to More only
                  for a keyboard: moving it there could clear the selection the toolbar needs. */}
              {/* The offset counts from More, which the capsule pads by 4px: 8 leaves the menu 4px
                  off the capsule instead of touching it, as the native toolbar's More menu sits. */}
              <DropdownMenuContent
                data-selection-toolbar
                side={side}
                sideOffset={8}
                align="start"
                onMouseDown={keep}
                onFocus={keepSelection}
                onCloseAutoFocus={(event) => {
                  if (!menuFromKeyboard.current) keep(event);
                }}
              >
                <CommandMenuItems
                  commands={commands}
                  onRun={(command) => void handOff((text) => onCommand?.(command, text, null))}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </Toolbar>
      </PopoverContent>
    </Popover>
  );
}
