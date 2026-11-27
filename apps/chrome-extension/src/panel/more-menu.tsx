import { Ellipsis } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelMessage } from '../messages/panel.ts';
import { BLOCK_KEYS } from './block-copy.ts';
import type { SiteState } from './model.ts';

type Choose = (message: PanelMessage, options?: { close: boolean }) => void;

/**
 * This website's permission (D6), as a checkable item: on, Atd may act on the origin in tasks the
 * person starts; off, acting on it asks first. Its second line says what the choice means, or why
 * it cannot change now (the choice travels to Atd). The item shows the person's choice at once
 * and follows the background again as soon as its allowed sites change (a refusal arrives as
 * unchanged sites and keeps the choice until the site changes or the panel reopens).
 */
function SiteItem({ site, onChoose }: { site: SiteState; onChoose: Choose }) {
  const { t } = useTranslation('panel');
  const labelId = useId();
  const noteId = useId();
  const [choice, setChoice] = useState<{ origin: string; from: boolean; to: boolean } | null>(null);
  // Once the background has moved on, its sites are the truth again; a kept choice would resurface
  // if the site later returned to the value it was toggled from. A choice belongs to its site: the
  // side panel stays open as the person moves to another.
  if (choice && (choice.origin !== site.origin || choice.from !== site.allowed)) setChoice(null);
  const checked =
    choice?.origin === site.origin && choice.from === site.allowed ? choice.to : site.allowed;
  const note = site.block
    ? t(BLOCK_KEYS[site.block])
    : checked
      ? t('page.siteOn')
      : t('page.siteOff');
  return (
    <button
      type="button"
      className="menu__item pp-menu-item"
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={site.block !== null}
      aria-labelledby={labelId}
      aria-describedby={noteId}
      onClick={() => {
        if (site.block) return;
        setChoice({ origin: site.origin, from: site.allowed, to: !checked });
        onChoose({ type: 'site.set', origin: site.origin, allowed: !checked });
      }}
    >
      <span className="pp-menu-lines">
        <span id={labelId}>{t('page.siteLabel', { host: site.host })}</span>
        <span className="pp-menu-note" id={noteId}>
          {note}
        </span>
      </span>
    </button>
  );
}

/**
 * The toolbar's More menu, a Mac pull-down: this page's permission while the window shows a
 * website, then the commands that go to the Atd shell, unavailable (dimmed, never hidden) while it
 * cannot be reached, and last the extension's own settings, which need no connection. The kit's
 * menu script anchors it to its button and adds the keyboard; as the toolbar popup, a command that
 * moves the person to Atd or to a tab also closes the popup.
 */
export function MoreMenu({
  site,
  shellEnabled,
  onChoose,
}: {
  /** This page's site, or null when the panel has no website to offer. */
  site: SiteState | null;
  /** Open Atd and Computer Use Settings can reach the shell. */
  shellEnabled: boolean;
  onChoose: Choose;
}) {
  const { t } = useTranslation('panel');
  const menuId = useId();
  const headerId = useId();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menu.current) window.AppleBlocks.menu.init(menu.current);
  }, []);
  const command = (message: PanelMessage) => () => {
    if (shellEnabled) onChoose(message, { close: true });
  };
  return (
    <>
      <button
        type="button"
        className="btn-plain btn-icon pp-more"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-label={t('actions.more')}
      >
        <Ellipsis aria-hidden="true" />
      </button>
      <div
        ref={menu}
        id={menuId}
        className="menu motion-pop pp-menu"
        popover="auto"
        role="menu"
        aria-label={t('actions.more')}
      >
        {site ? (
          <>
            <fieldset className="pp-menu-group" aria-labelledby={headerId}>
              <p className="menu__header" id={headerId}>
                {t('page.heading')}
              </p>
              <SiteItem site={site} onChoose={onChoose} />
            </fieldset>
            <hr className="menu__separator" />
          </>
        ) : null}
        <button
          type="button"
          className="menu__item pp-menu-item"
          role="menuitem"
          aria-disabled={!shellEnabled}
          onClick={command({ type: 'app.open' })}
        >
          {t('actions.openApp')}
        </button>
        <button
          type="button"
          className="menu__item pp-menu-item"
          role="menuitem"
          aria-disabled={!shellEnabled}
          onClick={command({ type: 'settings.open' })}
        >
          {t('actions.settings')}
        </button>
        <hr className="menu__separator" />
        <button
          type="button"
          className="menu__item pp-menu-item"
          role="menuitem"
          onClick={() => onChoose({ type: 'options.open' }, { close: true })}
        >
          {t('actions.extensionSettings')}
        </button>
      </div>
    </>
  );
}
