import { useTranslation } from 'react-i18next';
import type { PopupMessage } from '../messages/popup.ts';
import { Hero } from './header.tsx';
import type { NoticeKind } from './model.ts';

const NOTICE_KEYS = {
  connecting: { title: 'notice.connecting.title', body: 'notice.connecting.body' },
  disconnected: { title: 'notice.disconnected.title', body: 'notice.disconnected.body' },
  otherHost: { title: 'notice.otherHost.title', body: 'notice.otherHost.body' },
  serviceUnavailable: {
    title: 'notice.serviceUnavailable.title',
    body: 'notice.serviceUnavailable.body',
  },
  hostMissing: { title: 'notice.hostMissing.title', body: 'notice.hostMissing.body' },
  browserNotVerified: {
    title: 'notice.browserNotVerified.title',
    body: 'notice.browserNotVerified.body',
  },
  browserMismatch: {
    title: 'notice.browserMismatch.title',
    body: 'notice.browserMismatch.body',
  },
} as const satisfies Record<NoticeKind, { title: string; body: string }>;

/**
 * Why the popup cannot work with Atd right now, and the one step that may help: Reconnect dials
 * the native host again now instead of at the next backoff attempt. Once Atd has been opened,
 * a missing host is found by trying again. While a connection attempt runs, the same button is
 * busy in place.
 */
export function NoticeView({
  notice,
  send,
}: {
  notice: NoticeKind;
  send: (message: PopupMessage) => void;
}) {
  const { t } = useTranslation('popup');
  const busy = notice === 'connecting';
  const keys = NOTICE_KEYS[notice];
  return (
    <>
      <Hero title={t(keys.title)} body={t(keys.body)} />
      <button
        type="button"
        className="btn-filled btn-block pp-primary"
        aria-busy={busy}
        aria-disabled={busy}
        onClick={() => {
          if (!busy) send({ type: 'reconnect' });
        }}
      >
        {busy ? <span className="activity-indicator" aria-hidden="true" /> : null}
        {busy
          ? t('notice.connectingButton')
          : notice === 'hostMissing' ||
              notice === 'browserNotVerified' ||
              notice === 'browserMismatch'
            ? t('notice.tryAgain')
            : t('notice.reconnect')}
      </button>
    </>
  );
}
