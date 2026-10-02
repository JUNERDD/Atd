import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Switch } from '@ai/ui/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import { useOverlayFooter } from '../../components/use-overlay-footer';

/**
 * The Memory section's bottom action bar: the shared floating settings footer (`.editor-footer`,
 * `.overlay-footer`) holding the Automatic learning switch in a glass pill at the trailing edge,
 * where the other footers keep their actions. The pill is the switch's label, so a click anywhere
 * on it toggles; what learning does is its tooltip and the switch's description. A setting, not a
 * memory, so it stays out of the list. The switch is its own undo, so pausing asks no
 * confirmation.
 */
export function MemoryLearningFooter({
  checked,
  pending,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  /** A pause or resume is in flight: the switch stays focusable but ignores input. */
  pending: boolean;
  /** Memory has not loaded, or failed to. */
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation('memory');
  const footerRef = useOverlayFooter<HTMLElement>();
  const descriptionId = useId();
  return (
    <footer ref={footerRef} className="editor-footer overlay-footer">
      {/* The trailing actions slot, where the other footers keep theirs. */}
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="glass"
              className="cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-50"
            >
              <label htmlFor="memory-learning">
                {t('memory.learning.label')}
                <Switch
                  id="memory-learning"
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
            {t('memory.learning.description')}
          </TooltipContent>
        </Tooltip>
      </div>
      <span id={descriptionId} className="sr-only">
        {t('memory.learning.description')}
      </span>
    </footer>
  );
}
