import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Label } from '@atd/ui/components/label';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@atd/ui/components/item';
import type { SettingsSnapshot } from '../../client/settings-contract';
import {
  DEFAULT_PERMISSION_TIER,
  PERMISSION_TIERS,
  type PermissionTier,
} from '../../client/agent/permission-schema';
import { SettingsHeading } from './settings-heading';
import { useSettingsSectionExit } from './settings-navigation';

const TIER_COPY = {
  manual: {
    label: 'permissions.tiers.manual.label',
    description: 'permissions.tiers.manual.description',
  },
  auto: {
    label: 'permissions.tiers.auto.label',
    description: 'permissions.tiers.auto.description',
  },
  always: {
    label: 'permissions.tiers.always.label',
    description: 'permissions.tiers.always.description',
  },
} as const satisfies Record<
  PermissionTier,
  {
    label: `permissions.tiers.${PermissionTier}.label`;
    description: `permissions.tiers.${PermissionTier}.description`;
  }
>;

export function PermissionSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.settings;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSettingsSectionExit(() => setError(null));
  // Without the bridge or a snapshot the tiers cannot change at all; while a save is in flight
  // the radios stay focusable and changes are ignored until it settles.
  const unavailable = !bridge || !snapshot;
  const value = snapshot?.permissionTier ?? DEFAULT_PERMISSION_TIER;

  function select(tier: PermissionTier) {
    if (!bridge || unavailable || pending || tier === value) return;
    setPending(true);
    setError(null);
    void bridge.setPermissionTier(tier).then(
      () => {
        setPending(false);
      },
      (reason: unknown) => {
        setPending(false);
        setError(
          reason instanceof Error && reason.message ? reason.message : t('permissions.errors.save'),
        );
      },
    );
  }

  return (
    <section className="settings-permission-settings" aria-label={t('permissions.title')}>
      <SettingsHeading title={t('permissions.title')} description={t('permissions.description')} />
      <ItemGroup
        className="settings-permission-options"
        role="radiogroup"
        aria-label={t('permissions.title')}
        aria-disabled={unavailable || undefined}
        aria-busy={pending || undefined}
        aria-describedby={error ? 'settings-permission-error' : undefined}
      >
        {PERMISSION_TIERS.map((tier) => {
          const selected = value === tier;
          const id = `settings-permission-${tier}`;
          return (
            <Item
              asChild
              key={tier}
              variant={selected ? 'muted' : 'outline'}
              size="sm"
              className="settings-permission-option"
            >
              <li data-settings-anchor={`permission-tier-${tier}`}>
                <Label htmlFor={id} className="min-w-0 flex-1 items-start gap-3.5">
                  <input
                    id={id}
                    type="radio"
                    name="settings-permission-tier"
                    value={tier}
                    checked={selected}
                    disabled={unavailable}
                    className="peer mt-0.5 size-4 shrink-0 accent-primary"
                    onChange={() => select(tier)}
                  />
                  <ItemContent>
                    <ItemTitle className="whitespace-normal">{t(TIER_COPY[tier].label)}</ItemTitle>
                    <ItemDescription className="whitespace-normal">
                      {t(TIER_COPY[tier].description)}
                    </ItemDescription>
                  </ItemContent>
                </Label>
              </li>
            </Item>
          );
        })}
      </ItemGroup>
      {error && (
        <p id="settings-permission-error" className="settings-inline-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </section>
  );
}
