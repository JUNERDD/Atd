import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isLive, type ReplyView } from '../messages/views.ts';
import { RichText } from './rich-text.tsx';

const COPIED_MS = 1500;

/**
 * Atd's reply to a request from this extension, under its run: the same reply its HUD shows,
 * rendered from the tree the service worker parsed, clipped where the shell clipped it (Atd has it
 * in full). While the run is under way it is the message the run is writing or wrote last, which
 * grows in place and is busy (`aria-busy`), so a screen reader reads the answer rather than every
 * update. Once done it is the answer, with Copy, which copies its Markdown, and the conversation's
 * own actions after it (`children`: Reply, on its latest turn).
 */
export function RunReply({ reply, children }: { reply: ReplyView; children?: ReactNode }) {
  const { t } = useTranslation('panel');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const live = isLive(reply);
  return (
    <div className="pp-reply" aria-busy={live}>
      <div className="pp-reply-text">
        <RichText blocks={reply.blocks} />
      </div>
      {reply.clipped ? <p className="pp-reply-note">{t('runs.clipped')}</p> : null}
      {live ? null : (
        <div className="pp-reply-actions">
          <button
            type="button"
            className="btn-plain pp-reply-action"
            onClick={() => {
              navigator.clipboard.writeText(reply.text).then(
                () => setCopied(true),
                (error: unknown) => console.info('[atd] could not copy the reply', error),
              );
            }}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span aria-live="polite">{copied ? t('runs.copied') : t('runs.copy')}</span>
          </button>
          {children}
        </div>
      )}
    </div>
  );
}
