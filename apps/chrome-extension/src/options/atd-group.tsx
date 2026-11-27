import { useTranslation } from 'react-i18next';
import type { OptionsView } from '../messages/views.ts';
import { channelReach, linkStatus, shellAnswers, type LinkStatus } from '../pages/link.ts';
import { Group, Row } from './group.tsx';
import type { SendOption } from './use-options-channel.ts';

const STATUS_KEYS = {
  connected: 'atd.connected',
  connecting: 'atd.connecting',
  notConnected: 'atd.notConnected',
} as const satisfies Record<LinkStatus, string>;

/**
 * This browser's connection to Atd, as the panel's toolbar shows it, and the commands that go to
 * the Atd shell, as in the panel's More menu: unavailable (dimmed, never hidden) while the shell
 * cannot be reached. Connecting happens in the panel and disconnecting in Atd, so the group only
 * says where.
 */
export function AtdGroup({ view, send }: { view: OptionsView; send: SendOption }) {
  const { t } = useTranslation('options');
  const status = linkStatus(view, channelReach(view.connection));
  const enabled = shellAnswers(view);
  const paired = view.pairing.state === 'paired';
  const command = (type: 'app.open' | 'settings.open') => () => {
    if (enabled) send({ type });
  };
  return (
    <Group
      title={t('atd.heading')}
      actions={
        <>
          <button
            type="button"
            className="btn-bordered op-btn hit-extend"
            aria-disabled={!enabled}
            onClick={command('app.open')}
          >
            {t('atd.openApp')}
          </button>
          <button
            type="button"
            className="btn-bordered op-btn hit-extend"
            aria-disabled={!enabled}
            onClick={command('settings.open')}
          >
            {t('atd.settings')}
          </button>
        </>
      }
      footer={
        <p className="list-footer">{paired ? t('atd.footerPaired') : t('atd.footerUnpaired')}</p>
      }
    >
      <Row label={t('atd.connection')}>
        <output className="op-status" data-state={status}>
          <span className="link-dot" aria-hidden="true" />
          {t(STATUS_KEYS[status])}
        </output>
      </Row>
      {paired ? (
        <Row label={t('atd.browser')}>
          <span className="list__value op-value">{view.pairing.label || view.profileLabel}</span>
        </Row>
      ) : null}
    </Group>
  );
}
