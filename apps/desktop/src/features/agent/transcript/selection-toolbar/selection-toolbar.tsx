import { Brain, Check, Copy, Square, TextQuote, Volume2 } from 'lucide-react';
import { useMemo, useState, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuoteSource } from '@ai/agent-contracts';
import { Popover, PopoverAnchor, PopoverContent } from '@ai/ui/components/popover';
import { Toolbar, ToolbarButton } from '@ai/ui/components/toolbar';
import { IconButton } from '../../../../components/icon-button';
import { showErrorToast } from '../../../../components/toast-store';
import { useCopyFeedback } from '../use-copy-feedback';
import { useTurnSpeech } from '../use-turn-speech';
import { quoteSource } from './quote-source';
import { selectionMarkdown } from './selection-markdown';
import { useMessageSelection, type MessageSelection } from './use-message-selection';

/** The read-aloud key of a selection, apart from every turn's own; one selection reads at a time. */
const SELECTION_SPEECH = 'selection';

/** Keeps focus, and with it the page's selection, where it is. */
function keep(event: Event | SyntheticEvent) {
  event.preventDefault();
}

/**
 * Actions on text or elements selected in settled assistant messages under `root`: Quote in
 * reply, Copy, Read aloud and Remember, beside where the selection ends. The toolbar never takes
 * focus, so the selection stays visible and editable while it shows; once a keyboard reaches it,
 * it is one tab stop whose arrow keys move between the actions. Quote, Copy and Remember carry
 * the selection as Markdown (a code block it touches whole); reading aloud takes the text as
 * selected.
 */
export function SelectionToolbar({
  root,
  onQuote,
  onRemember,
}: {
  root: HTMLElement | null;
  /**
   * Adds the selection's Markdown to the reply draft as a quote, with where it was taken from;
   * without it there is no Quote.
   */
  onQuote?: ((markdown: string, source: QuoteSource | undefined) => void) | undefined;
  /** Starts a memory session seeded with the selection; without it the toolbar offers no Remember. */
  onRemember?: ((text: string) => void) | undefined;
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
        </Toolbar>
      </PopoverContent>
    </Popover>
  );
}
