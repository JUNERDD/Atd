import type { TFunction } from 'i18next';
import { ArrowUp, CircleAlert, Globe, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnInput } from '../channel/payloads.ts';
import type { AskFailure } from '../messages/views.ts';
import { BLOCK_KEYS } from './block-copy.ts';
import type { ActivePage, ComposeBlock } from './model.ts';
import { useComposer } from './use-composer.ts';
import type { PanelChannel } from './use-panel-channel.ts';

/**
 * The longest request the field takes, as the in-page ask's: below the 100 000 characters Atd
 * accepts, so the page's URL and title still fit beside it.
 */
const MAX_TEXT = 90_000;

const FAILURE_KEYS = {
  notConnected: 'compose.failure.notConnected',
  notPaired: 'compose.failure.notPaired',
  tooLong: 'compose.failure.tooLong',
  otherHost: 'compose.failure.otherHost',
  serviceUnavailable: 'compose.failure.serviceUnavailable',
  failed: 'compose.failure.failed',
} as const satisfies Record<AskFailure, string>;

interface Note {
  text: string;
  error: boolean;
}

/**
 * The line under the field, shown only while there is something to know: why the request failed,
 * else why it cannot be sent now, else that this tab's page cannot go along.
 */
function noteOf(
  t: TFunction<'panel'>,
  failure: AskFailure | null,
  block: ComposeBlock | null,
  page: ActivePage,
): Note | null {
  if (failure) return { text: t(FAILURE_KEYS[failure]), error: true };
  if (block) return { text: t(BLOCK_KEYS[block]), error: false };
  if (page.kind === 'other') return { text: t('compose.otherPage'), error: false };
  return null;
}

/**
 * The page a request takes along: a website's host, removable (the request then goes without the
 * page's URL and title), or the choice to include it again. Other tabs offer no page.
 */
function PageChip({
  page,
  included,
  onChange,
}: {
  page: ActivePage;
  included: boolean;
  onChange: (include: boolean) => void;
}) {
  const { t } = useTranslation('panel');
  if (page.kind !== 'web') return null;
  if (!included) {
    return (
      <button type="button" className="pp-chip pp-chip-add" onClick={() => onChange(true)}>
        <Plus aria-hidden="true" />
        {t('compose.addPage')}
      </button>
    );
  }
  return (
    <span className="pp-chip" title={page.host}>
      <Globe aria-hidden="true" />
      <span className="pp-chip-name">{page.host}</span>
      <button
        type="button"
        className="pp-chip-x"
        aria-label={t('compose.removePage')}
        title={t('compose.removePage')}
        onClick={() => onChange(false)}
      >
        <X aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * The panel's composer (D10, replacing the hand-off to the in-page ask): the request, the page it
 * takes along, and Send. Return sends and Shift-Return starts a new line; an IME composition keeps
 * its Return. While the request cannot go, the draft stays editable and the line under it says
 * why.
 */
export function Composer({
  page,
  block,
  channel,
  takeOwnInput,
}: {
  page: ActivePage;
  block: ComposeBlock | null;
  channel: Pick<PanelChannel, 'send' | 'onAskStatus'>;
  takeOwnInput: () => OwnInput | undefined;
}) {
  const { t } = useTranslation('panel');
  const noteId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const focusField = useCallback(() => field.current?.focus(), []);
  const composer = useComposer({
    page,
    block,
    send: channel.send,
    onAskStatus: channel.onAskStatus,
    takeOwnInput,
    failed: focusField,
  });
  // The panel opens to write a request, so the field takes focus as it appears, as the in-page
  // ask's does when it opens.
  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  const note = noteOf(t, composer.failure, block, page);
  const withPage = page.kind === 'web' && composer.includePage;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    composer.submit();
  };
  return (
    <form
      className="pp-compose"
      onSubmit={(event) => {
        event.preventDefault();
        composer.submit();
      }}
    >
      <div className="pp-compose-box">
        <textarea
          ref={field}
          className="pp-compose-field"
          rows={2}
          maxLength={MAX_TEXT}
          enterKeyHint="send"
          value={composer.text}
          readOnly={composer.sending}
          placeholder={withPage ? t('compose.placeholder') : t('compose.placeholderNoPage')}
          aria-label={t('compose.label')}
          aria-describedby={note ? noteId : undefined}
          aria-invalid={composer.failure !== null}
          onChange={(event) => composer.setText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <div className="pp-compose-bar">
          <PageChip
            page={page}
            included={composer.includePage}
            onChange={(include) => {
              composer.setIncludePage(include);
              focusField();
            }}
          />
          <button
            type="submit"
            className="btn-filled btn-icon pp-send"
            disabled={!composer.canSend && !composer.sending}
            aria-disabled={composer.sending}
            aria-busy={composer.sending}
            aria-label={t('compose.send')}
            title={t('compose.send')}
          >
            {composer.sending ? (
              <span className="activity-indicator" aria-hidden="true" />
            ) : (
              <ArrowUp aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      {note ? (
        <p
          id={noteId}
          className="field-message pp-compose-note"
          data-tone={note.error ? 'error' : undefined}
          role={note.error ? 'alert' : undefined}
        >
          {note.error ? <CircleAlert aria-hidden="true" /> : null}
          {note.text}
        </p>
      ) : null}
    </form>
  );
}
