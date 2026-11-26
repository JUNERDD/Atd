import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReplyView } from '../messages/views.ts';
import { RichText } from './rich-text.tsx';

const COPIED_MS = 1500;

/**
 * Atd's reply to a request from this extension, under its finished run: the same reply its HUD
 * shows, rendered from the tree the service worker parsed, clipped where the shell clipped it (Atd
 * has it in full), with Copy, which copies its Markdown.
 */
export function RunReply({ reply }: { reply: ReplyView }) {
  const { t } = useTranslation('panel');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="pp-reply">
      <div className="pp-reply-text">
        <RichText blocks={reply.blocks} />
      </div>
      {reply.clipped ? <p className="pp-reply-note">{t('runs.clipped')}</p> : null}
      <button
        type="button"
        className="btn-plain pp-reply-copy"
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
    </div>
  );
}
