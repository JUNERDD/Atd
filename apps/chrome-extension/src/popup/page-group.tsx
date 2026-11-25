import { Globe, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PopupMessage } from '../messages/popup.ts';
import type { ActivePage, AskBlock, ChannelBlock } from './model.ts';

type Send = (message: PopupMessage, options?: { close: boolean }) => void;

/** Why a row on this page is unavailable, shown as its subtitle (one vocabulary for both rows). */
const BLOCK_KEYS = {
  notPaired: 'page.blocked.notPaired',
  connecting: 'page.blocked.connecting',
  notConnected: 'page.blocked.notConnected',
  otherHost: 'page.blocked.otherHost',
  serviceUnavailable: 'page.blocked.serviceUnavailable',
  page: 'page.blocked.page',
  busy: 'page.blocked.busy',
} as const satisfies Record<Exclude<AskBlock, null>, string>;

/**
 * "Ask Atd on This Page…" opens the in-page ask in the tab and closes the popup. While it is
 * unavailable the row stays in place, dimmed, with the reason as its subtitle; its shortcut sits
 * where a Mac menu puts one.
 */
function AskRow({
  page,
  block,
  shortcut,
  send,
}: {
  page: ActivePage;
  block: AskBlock;
  shortcut: string;
  send: Send;
}) {
  const { t } = useTranslation('popup');
  return (
    <li>
      <button
        type="button"
        className="list__row pp-ask-row"
        aria-disabled={block !== null}
        onClick={() => {
          if (block === null && page.kind === 'web') {
            send({ type: 'ask.open', tabId: page.tabId }, { close: true });
          }
        }}
      >
        <span className="list__icon pp-icon-ask" aria-hidden="true">
          <Sparkles />
        </span>
        <span className="pp-lines">
          <span className="list__label">{t('page.ask')}</span>
          {block ? <span className="list__subtitle">{t(BLOCK_KEYS[block])}</span> : null}
        </span>
        {shortcut ? <kbd className="pp-key">{shortcut}</kbd> : null}
      </button>
    </li>
  );
}

/**
 * The page's site switch (D6): on, Atd may act on this origin in tasks the person starts. The
 * choice travels to Atd, so while it cannot the switch is disabled and says why, as the ask row
 * does.
 */
function SiteRow({
  host,
  checked,
  block,
  onToggle,
}: {
  host: string;
  checked: boolean;
  block: ChannelBlock | null;
  onToggle: (allowed: boolean) => void;
}) {
  const { t } = useTranslation('popup');
  const reasonId = useId();
  return (
    <li>
      <label className="list__row pp-site-row">
        <span className="list__icon pp-icon-site" aria-hidden="true">
          <Globe />
        </span>
        <span className="pp-lines">
          <span className="list__label pp-host">{host}</span>
          {block ? (
            <span className="list__subtitle" id={reasonId}>
              {t(BLOCK_KEYS[block])}
            </span>
          ) : null}
        </span>
        <input
          className="switch"
          type="checkbox"
          role="switch"
          checked={checked}
          aria-checked={checked}
          disabled={block !== null}
          aria-label={t('page.siteLabel', { host })}
          aria-describedby={block ? reasonId : undefined}
          onChange={(event) => onToggle(event.currentTarget.checked)}
        />
      </label>
    </li>
  );
}

/**
 * This page: the ask and, on a website, its site permission. Off, acting on the site asks first.
 * The switch and its footer show the person's choice at once and follow the background again as
 * soon as its allowed sites change (a refusal arrives as unchanged sites and keeps the choice
 * until the popup reopens).
 */
export function PageGroup({
  page,
  sites,
  block,
  shortcut,
  siteBlock,
  send,
}: {
  page: ActivePage;
  sites: string[];
  block: AskBlock;
  shortcut: string;
  /** Why the site switch cannot change now (null when it can). */
  siteBlock: ChannelBlock | null;
  send: Send;
}) {
  const { t } = useTranslation('popup');
  const allowed = page.kind === 'web' && sites.includes(page.origin);
  const [choice, setChoice] = useState<{ from: boolean; to: boolean } | null>(null);
  // Once the background has moved on, its sites are the truth again; a kept choice would resurface
  // if the site later returned to the value it was toggled from.
  if (choice && choice.from !== allowed) setChoice(null);
  const checked = choice && choice.from === allowed ? choice.to : allowed;
  return (
    <>
      <h2 className="list-header">{t('page.heading')}</h2>
      <ul className="list pp-page-list">
        <AskRow page={page} block={block} shortcut={shortcut} send={send} />
        {page.kind === 'web' ? (
          <SiteRow
            host={page.host}
            checked={checked}
            block={siteBlock}
            onToggle={(next) => {
              setChoice({ from: allowed, to: next });
              send({ type: 'site.set', origin: page.origin, allowed: next });
            }}
          />
        ) : null}
      </ul>
      <p className="list-footer">
        {page.kind !== 'web'
          ? t('page.unavailableNote')
          : checked
            ? t('page.siteOn')
            : t('page.siteOff')}
      </p>
    </>
  );
}
