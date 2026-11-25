import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PopupMessage } from '../messages/popup.ts';
import type { PairFailure, PairingView } from '../messages/views.ts';
import { Hero } from './header.tsx';

/**
 * Copy for each reason pairing did not complete (the background narrows Atd's codes to these). The
 * person reads why in their own words; a code or text from Atd is never shown as is.
 */
const FAILURE_KEYS = {
  busy: 'connect.failure.busy',
  cooldown: 'connect.failure.cooldown',
  unavailable: 'connect.failure.generic',
  failed: 'connect.failure.generic',
  unknown: 'connect.failure.generic',
  otherHost: 'connect.failure.otherHost',
  serviceUnavailable: 'connect.failure.serviceUnavailable',
  denied: 'connect.failure.denied',
  notConnected: 'connect.failure.notConnected',
} as const satisfies Record<PairFailure, string>;

/** Why the last Connect… did not pair, or null while nothing failed. */
function failureOf(pairing: PairingView): PairFailure | null {
  if (pairing.state === 'denied') return pairing.reason ?? 'denied';
  if (pairing.state === 'error') return pairing.reason ?? 'unknown';
  return null;
}

/**
 * The pairing code, large and monospaced so it is easy to compare with Atd's confirmation. Screen
 * readers get it character by character.
 */
function PairingCode({ code }: { code: string }) {
  const chars = Array.from(code);
  return (
    <span className="pp-code">
      <span className="sr-only">{chars.join(' ')}</span>
      <span className="pp-code-chars" aria-hidden="true">
        {chars.map((char, index) => (
          <span key={`${index}:${char}`} className="pp-code-char">
            {char}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * First connection (decision 3): Connect… asks Atd to pair, and Atd confirms in a native alert
 * naming this browser and the same 4-character code. While Atd waits for that answer the button
 * stays busy in place and Cancel withdraws the request; a refusal or failure returns to Connect…
 * with the reason under it.
 */
export function ConnectView({
  pairing,
  profileLabel,
  send,
}: {
  pairing: PairingView;
  profileLabel: string;
  send: (message: PopupMessage) => void;
}) {
  const { t } = useTranslation('popup');
  const pending = pairing.state === 'pending';
  const failure = failureOf(pairing);
  return (
    <>
      <Hero title={t('connect.title')} body={t('connect.body')} />
      <ul className="list">
        <li>
          <div className="list__row">
            <span className="list__label">{t('connect.browser')}</span>
            <span className="list__value">{profileLabel}</span>
          </div>
        </li>
        {pending && pairing.code ? (
          <li>
            <div className="list__row">
              <span className="list__label">{t('connect.code')}</span>
              <PairingCode code={pairing.code} />
            </div>
          </li>
        ) : null}
      </ul>
      <button
        type="button"
        className="btn-filled btn-block pp-primary"
        aria-busy={pending}
        aria-disabled={pending}
        onClick={() => {
          if (!pending) send({ type: 'pair.start' });
        }}
      >
        {pending ? <span className="activity-indicator" aria-hidden="true" /> : null}
        {pending ? t('connect.waiting') : t('connect.button')}
      </button>
      {pending ? (
        <>
          <p className="field-message pp-center">{t('connect.confirmNote')}</p>
          <button
            type="button"
            className="btn-plain pp-cancel"
            onClick={() => send({ type: 'pair.cancel' })}
          >
            {t('connect.cancel')}
          </button>
        </>
      ) : null}
      {failure ? (
        <output className="field-message pp-center" data-tone="error">
          <CircleAlert aria-hidden="true" />
          {t(FAILURE_KEYS[failure])}
        </output>
      ) : null}
    </>
  );
}
