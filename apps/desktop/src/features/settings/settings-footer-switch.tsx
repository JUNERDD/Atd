import { useId } from 'react';
import { Button } from '@atd/ui/components/button';
import { Switch } from '@atd/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';

/**
 * A page-wide setting in a settings page's floating footer (the Memory section's learning, the
 * Automations pause): a glass pill that labels its switch, so a click anywhere on it toggles; what
 * the setting does is its tooltip and the switch's description.
 */
export function SettingsFooterSwitch({
  label,
  description,
  checked,
  pending,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  pending: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const switchId = useId();
  const descriptionId = useId();
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="glass"
            className="cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-50"
          >
            <label htmlFor={switchId}>
              {label}
              <Switch
                id={switchId}
                size="sm"
                aria-describedby={descriptionId}
                aria-disabled={pending || undefined}
                aria-busy={pending || undefined}
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => {
                  if (!pending) onCheckedChange(value);
                }}
              />
            </label>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-80">
          {description}
        </TooltipContent>
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
    </>
  );
}
