import { Shield } from 'lucide-react';
import openaiLogo from '@ai/ui/assets/brands/openai.svg';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';

export function ComposerConfiguration() {
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
            aria-label="Models: OpenAI, GPT-6 Astra"
          >
            <span
              className="provider-logo"
              style={{ maskImage: `url("${openaiLogo}")` }}
              aria-hidden="true"
            />
            <span className="composer-config-label">GPT-6 Astra</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" sideOffset={4} collisionPadding={16}>
          Models
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
