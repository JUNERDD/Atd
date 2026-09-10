import { Plug, Shield } from 'lucide-react';
import type { ProviderSettings } from '../../electron/settings-contract';
import openaiLogo from '@ai/ui/assets/brands/openai.svg';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';

interface ComposerConfigurationProps {
  provider?: ProviderSettings;
  onOpenSettings?: () => void;
}

export function ComposerConfiguration({ provider, onOpenSettings }: ComposerConfigurationProps) {
  const model = provider?.model || 'Choose model';
  return (
    <div className="composer-configuration" aria-label="Task configuration">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="xs" aria-label="Permissions: Ask first">
            <Shield />
            <span className="composer-config-label">Ask first</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" sideOffset={4} collisionPadding={16}>
          Permissions
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="composer-model"
            aria-label={`Models: ${model}`}
            onClick={onOpenSettings}
          >
            {provider?.id === 'openai-compatible' ? (
              <Plug />
            ) : (
              <span
                className="provider-logo"
                style={{ maskImage: `url("${openaiLogo}")` }}
                aria-hidden="true"
              />
            )}
            <span className="composer-config-label">{model}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" sideOffset={4} collisionPadding={16}>
          Models
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
