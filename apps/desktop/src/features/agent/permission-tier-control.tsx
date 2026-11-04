import { useState } from 'react';
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { cn } from '@atd/ui/lib/utils';
import {
  DEFAULT_PERMISSION_TIER,
  PERMISSION_TIERS,
  type PermissionTier,
} from '../../client/agent/permission-schema';
import { taskPermissionTier, type AgentTask } from '../../client/agent/task-schema';
import { AlwaysAllowDialog } from '../settings/always-allow-dialog';
import { useSettingsSnapshot } from '../settings/use-settings';
import { agentApi } from './use-agent';
import { showErrorToast } from '../../components/toast-store';

function TierIcon({ tier, className }: { tier: PermissionTier; className?: string }) {
  switch (tier) {
    case 'manual':
      return <ShieldAlert className={className} />;
    case 'auto':
      return <Shield className={className} />;
    case 'always':
      return <ShieldCheck className={className} />;
    default: {
      const exhaustive: never = tier;
      return exhaustive;
    }
  }
}

export function PermissionTierControl({
  taskId,
  task,
}: {
  taskId: string | null;
  task: AgentTask | null;
}) {
  const { t } = useTranslation('panel');
  const { snapshot } = useSettingsSnapshot();
  const settingsBridge = window.desktop?.settings;
  const [confirmingAlways, setConfirmingAlways] = useState(false);
  // A task view edits that task's tier; the home view has no task yet, so it edits the
  // Settings default the next task will freeze at creation.
  const writable = Boolean(taskId && task) || (!taskId && Boolean(settingsBridge));
  const tier = task
    ? taskPermissionTier(task)
    : (snapshot?.permissionTier ?? DEFAULT_PERMISSION_TIER);
  function apply(next: PermissionTier) {
    if (taskId && task) {
      void agentApi()
        .setPermissionTier(taskId, next)
        .catch((error) => showErrorToast(error));
      return;
    }
    if (!settingsBridge) return;
    void settingsBridge.setPermissionTier(next).catch((error) => showErrorToast(error));
  }
  const trigger = (
    <Button
      type="button"
      variant="glass-ghost"
      size="xs"
      disabled={!writable}
      className={cn(tier === 'always' && 'text-destructive')}
      aria-label={t('permission.tierLabel')}
    >
      {/* The xs button centers the icon on Inter's cap height; CJK ideographs and lowercase
          labels sit about 1px lower, so the icon drops 1px to meet the label optically. */}
      <TierIcon tier={tier} className="translate-y-px" />
      <span className="composer-config-label">{t(`permission.tier.${tier}`)}</span>
    </Button>
  );
  if (!writable)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0">{trigger}</span>
        </TooltipTrigger>
        <TooltipContent side="top">{t('permission.defaultFromSettings')}</TooltipContent>
      </Tooltip>
    );
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={tier}
            onValueChange={(value) => {
              const next = PERMISSION_TIERS.find((item) => item === value);
              if (!next || next === tier) return;
              if (next === 'always') setConfirmingAlways(true);
              else apply(next);
            }}
          >
            {PERMISSION_TIERS.map((item) => {
              const unattended = item === 'always';
              return (
                <DropdownMenuRadioItem
                  key={item}
                  value={item}
                  variant={unattended ? 'destructive' : 'default'}
                  className="items-center"
                >
                  <TierIcon tier={item} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span>{t(`permission.tier.${item}`)}</span>
                    <span
                      className={cn(
                        'text-xs font-normal',
                        unattended ? 'text-destructive/80' : 'text-muted-foreground',
                      )}
                    >
                      {t(`permission.tierDescription.${item}`)}
                    </span>
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlwaysAllowDialog
        open={confirmingAlways}
        onOpenChange={setConfirmingAlways}
        onConfirm={() => apply('always')}
      />
    </>
  );
}
