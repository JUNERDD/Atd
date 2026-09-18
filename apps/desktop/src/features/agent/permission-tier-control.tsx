import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import { PERMISSION_TIERS, type PermissionTier } from '../../../electron/agent/permission-schema';
import { taskPermissionTier, type AgentTask } from '../../../electron/agent/task-schema';
import { useSettingsSnapshot } from '../settings/use-settings';
import { agentApi } from './use-agent';
import { showErrorToast } from '../../components/toast-store';

function TierIcon({ tier }: { tier: PermissionTier }) {
  switch (tier) {
    case 'manual':
      return <ShieldAlert />;
    case 'auto':
      return <Shield />;
    case 'always':
      return <ShieldCheck />;
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
  const writable = Boolean(taskId && task);
  const tier = task ? taskPermissionTier(task) : (snapshot?.permissionTier ?? 'manual');
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      disabled={!writable}
      aria-label={t('permission.tierLabel')}
    >
      <TierIcon tier={tier} />
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuRadioGroup
          value={tier}
          onValueChange={(value) => {
            const next = PERMISSION_TIERS.find((item) => item === value);
            if (!next || !taskId) return;
            void agentApi()
              .setPermissionTier(taskId, next)
              .catch((error) => showErrorToast(error));
          }}
        >
          {PERMISSION_TIERS.map((item) => (
            <DropdownMenuRadioItem key={item} value={item} className="items-start">
              <TierIcon tier={item} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{t(`permission.tier.${item}`)}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t(`permission.tierDescription.${item}`)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
