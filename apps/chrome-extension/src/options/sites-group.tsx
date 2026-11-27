import { useId, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChannelBlock } from '../pages/link.ts';
import { Group, Row } from './group.tsx';
import { hostOf } from './model.ts';
import type { SendOption } from './use-options-channel.ts';

/**
 * Why the list cannot change now, in the panel's vocabulary for what cannot reach Atd
 * (`panel/block-copy.ts`), written for this group's footer.
 */
const BLOCK_KEYS = {
  notPaired: 'sites.blocked.notPaired',
  connecting: 'sites.blocked.connecting',
  notConnected: 'sites.blocked.notConnected',
  otherHost: 'sites.blocked.otherHost',
  serviceUnavailable: 'sites.blocked.serviceUnavailable',
} as const satisfies Record<ChannelBlock, string>;

/**
 * Keyboard focus stays with the list when a Remove button leaves with its row: on the next row's,
 * else the previous row's, else (the last website went) on the group's title. Moved before the row
 * goes, so it never falls back to the page.
 */
function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  if (document.activeElement !== event.currentTarget) return;
  const row = event.currentTarget.closest('li');
  const neighbor = row?.nextElementSibling ?? row?.previousElementSibling;
  const target = neighbor?.querySelector('button') ?? row?.closest('section')?.querySelector('h2');
  if (target instanceof HTMLElement) target.focus();
}

/**
 * The websites the person allowed (D6), each with Remove. A removal travels to Atd, whose list is
 * the truth: the row leaves at once and stays gone while the view still lists its origin (Atd has
 * not answered, or refused), until the view no longer does. While nothing can reach Atd, Remove is
 * unavailable (dimmed, never hidden) and the second footer says why, when there is one to remove. Websites are added from the
 * panel's More menu, on the website itself.
 */
export function SitesGroup({
  sites,
  block,
  send,
}: {
  sites: string[];
  block: ChannelBlock | null;
  send: SendOption;
}) {
  const { t } = useTranslation('options');
  const reasonId = useId();
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  // A removal Atd carried out is in the view now; only the others still hide a row.
  const pending = [...removing].filter((origin) => sites.includes(origin));
  if (pending.length !== removing.size) setRemoving(new Set(pending));
  const shown = sites.filter((origin) => !removing.has(origin));
  const remove = (origin: string, event: MouseEvent<HTMLButtonElement>) => {
    if (block) return;
    if (!send({ type: 'site.set', origin, allowed: false })) return;
    keepFocus(event);
    setRemoving((current) => new Set(current).add(origin));
  };
  return (
    <Group
      title={t('sites.heading')}
      footer={
        <>
          <p className="list-footer">{t('sites.footer')}</p>
          {block && shown.length > 0 ? (
            <p className="list-footer" id={reasonId}>
              {t(BLOCK_KEYS[block])}
            </p>
          ) : null}
        </>
      }
    >
      {shown.length > 0 ? (
        shown.map((origin) => {
          const host = hostOf(origin);
          return (
            <Row key={origin} label={host}>
              <button
                type="button"
                className="btn-bordered op-btn hit-extend"
                aria-label={t('sites.removeLabel', { host })}
                aria-disabled={block !== null}
                aria-describedby={block ? reasonId : undefined}
                onClick={(event) => remove(origin, event)}
              >
                {t('sites.remove')}
              </button>
            </Row>
          );
        })
      ) : (
        <Row label={t('sites.empty')} secondary />
      )}
    </Group>
  );
}
