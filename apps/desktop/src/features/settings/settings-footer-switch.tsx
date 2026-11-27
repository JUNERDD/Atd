import { useId } from 'react';
import { Button } from '@atd/ui/components/button';
import { Switch } from '@atd/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { CompactTip } from '../../components/bar-action';
import { useCompacted } from '../../components/one-line-actions';

/**
 * A page-wide setting in a settings page's floating footer (the Memory section's learning, the
 * Automations pause, the Commands typing effect): a glass pill that labels its switch, so a click
 * anywhere on it toggles; what the setting does is its tooltip and the switch's description.
 * Where the footer is short of room (`useActionFooter`) the pill shows its switch alone and its
 * tooltip names the setting first; the label stays the switch's name.
 */
export function SettingsFooterSwitch({
  label,
  description,
  anchor,
  checked,
  pending,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  /** The `data-settings-anchor` that settings search reveals. */
  anchor?: string;
  checked: boolean;
  pending: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const switchId = useId();
  const descriptionId = useId();
  const { ref, compact } = useCompacted<HTMLLabelElement>();
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            asChild
            variant="glass"
            className="cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-50"
          >
            <label
              ref={ref}
              htmlFor={switchId}
              data-settings-anchor={anchor}
              data-bar-action="control"
            >
              <span data-slot="bar-label">{label}</span>
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
          {compact ? <CompactTip label={label} detail={description} /> : description}
        </TooltipContent>
      </Tooltip>
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
    </>
  );
}
