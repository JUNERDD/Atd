import { useTranslation } from 'react-i18next';
import type { PanelMessage } from '../messages/panel.ts';
import type { LinkStatus } from '../pages/link.ts';
import type { SiteState } from './model.ts';
import { MoreMenu } from './more-menu.tsx';

const STATUS_KEYS = {
  connected: 'header.connected',
  connecting: 'header.connecting',
  notConnected: 'header.notConnected',
} as const satisfies Record<LinkStatus, string>;

/**
 * The panel's toolbar, as a Mac sidebar's: the connection on the leading side and the More menu on
 * the trailing one. Chrome's own side panel header above it already names the extension (and its
 * development flavor) and holds pin and close, so the panel repeats neither.
 */
export function PanelToolbar({
  status,
  site,
  shellEnabled,
  onChoose,
}: {
  /** Null while the first state is on its way. */
  status: LinkStatus | null;
  site: SiteState | null;
  shellEnabled: boolean;
  onChoose: (message: PanelMessage, options?: { close: boolean }) => void;
}) {
  const { t } = useTranslation('panel');
  return (
    <header className="pp-toolbar">
      {status ? (
        <output className="pp-status" data-state={status}>
          <span className="link-dot" aria-hidden="true" />
          {t(STATUS_KEYS[status])}
        </output>
      ) : (
        <span />
      )}
      <MoreMenu site={site} shellEnabled={shellEnabled} onChoose={onChoose} />
    </header>
  );
}
