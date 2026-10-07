import { useTranslation } from 'react-i18next';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsFooterSwitch } from '../settings/settings-footer-switch';

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
        <SettingsFooterSwitch
          label={t('memory.learning.label')}
          description={t('memory.learning.description')}
          checked={learning}
          pending={pending}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ paused: !checked })}
        />
        <SettingsFooterSwitch
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
