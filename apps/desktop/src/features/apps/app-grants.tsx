import { RotateCcw, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppDetail, Capability, GrantState } from '@atd/agent-contracts';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Switch } from '@atd/ui/components/switch';
import { IconButton } from '../../components/icon-button';
import { AppDetailSection, AppDetailStatusRow } from './app-detail-group';
import { CAPABILITY_ICONS } from './capability-icons';
import type { AppIntent } from './use-app-intent';

/**
 * One capability the app declares (Figma `App / App capability grant row`): what it is, where its
 * answer stands, and the switch that allows or denies it. An answered capability offers Ask again,
 * which forgets the answer so the app's next use asks; a capability never asked reads "Not asked
 * yet" with the switch off, and turning it on allows it. A consent waiting in the panel reads
 * "Waiting for permission" until it is answered there or here. The switch keeps the trailing edge
 * whether Ask again shows or not.
 */
function AppGrantRow({
  detail,
  capability,
  waiting,
  busy,
  saving,
  onChange,
}: {
  detail: AppDetail;
  capability: Capability;
  waiting: boolean;
  busy: boolean;
  saving: boolean;
  onChange: (state: GrantState | null) => void;
}) {
  const { t } = useTranslation('apps');
  const state = detail.grants[capability];
  const label = t(`capability.${capability}.label`);
  const Icon = CAPABILITY_ICONS[capability];
  const status = waiting
    ? t('settings.waiting')
    : state === 'granted'
      ? t('detail.permissions.granted')
      : state === 'denied'
        ? t('detail.permissions.denied')
        : t('detail.permissions.notAsked');
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li aria-busy={saving || undefined}>
        <ItemMedia variant="icon">
          <Icon />
        </ItemMedia>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">{label}</ItemTitle>
          <ItemDescription className="whitespace-normal">
            {t('detail.permissions.status', {
              status,
              description: t(`capability.${capability}.description`),
            })}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          {state !== undefined && (
            <IconButton
              label={t('detail.permissions.askAgain')}
              aria-label={t('detail.permissions.askAgainLabel', { capability: label })}
              aria-disabled={busy || undefined}
              onClick={() => onChange(null)}
            >
              <RotateCcw />
            </IconButton>
          )}
          <Switch
            aria-label={t('detail.permissions.allowLabel', {
              capability: label,
              name: detail.name,
            })}
            aria-disabled={busy || undefined}
            aria-busy={saving || undefined}
            className="aria-disabled:cursor-not-allowed"
            checked={state === 'granted'}
            onCheckedChange={(checked) => onChange(checked ? 'granted' : 'denied')}
          />
        </ItemActions>
      </li>
    </Item>
  );
}

/**
 * What the app may use beyond its own storage: one row per declared capability, or a single row
 * saying it uses none. The rows wait for the app's details, loading in place.
 */
export function AppPermissionsSection({
  detail,
  error,
  onRetry,
  busy,
  pending,
  onChange,
}: {
  /** Null until the first read answers. */
  detail: AppDetail | null;
  error: string | null;
  onRetry: () => void;
  busy: boolean;
  pending: AppIntent | null;
  onChange: (capability: Capability, state: GrantState | null) => void;
}) {
  const { t } = useTranslation('apps');
  const waiting = new Set(detail?.consents.map((consent) => consent.capability));
  const none = detail !== null && detail.capabilities.length === 0;
  return (
    <AppDetailSection
      title={t('detail.permissions.title')}
      footer={none ? undefined : t('detail.permissions.footer')}
    >
      {!detail ? (
        <AppDetailStatusRow error={error} onRetry={onRetry} />
      ) : none ? (
        <Item asChild size="sm" className="settings-card-row">
          <li>
            <ItemMedia variant="icon">
              <ShieldCheck />
            </ItemMedia>
            <ItemContent>
              <ItemDescription className="whitespace-normal">
                {t('detail.permissions.none')}
              </ItemDescription>
            </ItemContent>
          </li>
        </Item>
      ) : (
        detail.capabilities.map((capability) => (
          <AppGrantRow
            key={capability}
            detail={detail}
            capability={capability}
            waiting={waiting.has(capability)}
            busy={busy}
            saving={pending === `grant:${capability}`}
            onChange={(state) => onChange(capability, state)}
          />
        ))
      )}
    </AppDetailSection>
  );
}
