import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Switch } from '@atd/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { useOverlayFooter } from '../../components/use-overlay-footer';

/**
 * One setting of the footer: a glass pill that labels its switch, so a click anywhere on it
 * toggles; what the setting does is its tooltip and the switch's description.
 */
function FooterSwitch({
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

/**
 * The Memory section's bottom action bar: the shared floating settings footer (`.editor-footer`,
 * `.overlay-footer`) holding the learning settings at the trailing edge, where the other footers
 * keep their actions; they wrap onto a second line in a narrow window. Automatic learning, then
 * Ask before saving, which routes what learning would save to Suggestions and only matters while
 * learning runs, so it waits while learning is paused and says why. Settings, not memories, so
 * they stay out of the list; each switch is its own undo, so neither asks for confirmation.
 */
export function MemoryLearningFooter({
  learning,
  askFirst,
  pending,
  disabled,
  onChange,
}: {
  /** Automatic learning runs (it is not paused). */
  learning: boolean;
  askFirst: boolean;
  /** A settings write is in flight: the switches stay focusable but ignore input. */
  pending: boolean;
  /** Memory has not loaded, or failed to. */
  disabled: boolean;
  onChange: (settings: { paused?: boolean; askFirst?: boolean }) => void;
}) {
  const { t } = useTranslation('memory');
  const footerRef = useOverlayFooter<HTMLElement>();
  return (
    <footer ref={footerRef} className="editor-footer overlay-footer">
      {/* The trailing actions slot, where the other footers keep theirs. */}
      <div className="flex-wrap justify-end">
        <FooterSwitch
          label={t('memory.learning.label')}
          description={t('memory.learning.description')}
          checked={learning}
          pending={pending}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ paused: !checked })}
        />
        <FooterSwitch
          label={t('memory.askFirst.label')}
          description={
            learning ? t('memory.askFirst.description') : t('memory.askFirst.pausedHint')
          }
          checked={askFirst}
          pending={pending}
          disabled={disabled || !learning}
          onCheckedChange={(checked) => onChange({ askFirst: checked })}
        />
      </div>
    </footer>
  );
}
