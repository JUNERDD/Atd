import { useTranslation } from 'react-i18next';
import type { LinkStatus } from './model.ts';

const STATUS_KEYS = {
  connected: 'header.connected',
  connecting: 'header.connecting',
  notConnected: 'header.notConnected',
} as const satisfies Record<LinkStatus, string>;

/**
 * The popup's title row, like a menu bar extra's: the mark, the name, and the connection. The
 * development flavor carries the outlined DEV label the panel and menu bar show beside the mark,
 * a build marker that is not translated.
 */
export function PopupHeader({
  status,
  dev,
}: {
  /** Null while the first state is on its way. */
  status: LinkStatus | null;
  /** This build is the development flavor (known at build time, before any state arrives). */
  dev: boolean;
}) {
  const { t } = useTranslation('popup');
  return (
    <header className="pp-head">
      <span className="pp-mark" aria-hidden="true" />
      <h1 className="t-headline">Atd</h1>
      {dev ? <span className="pp-flavor t-caption1">DEV</span> : null}
      {status ? (
        <output className="pp-status t-subheadline" data-state={status}>
          <span className="pp-dot" aria-hidden="true" />
          {t(STATUS_KEYS[status])}
        </output>
      ) : null}
    </header>
  );
}

/** The centered block that opens the connect flow and every explanatory state. */
export function Hero({ title, body }: { title: string; body: string }) {
  return (
    <section className="pp-hero">
      <span className="pp-tile" aria-hidden="true">
        <span className="pp-mark" />
      </span>
      <h2 className="t-title3">{title}</h2>
      <p className="pp-hero-body t-subheadline">{body}</p>
    </section>
  );
}
