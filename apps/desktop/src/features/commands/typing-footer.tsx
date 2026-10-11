import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'motion/react';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsFooterSwitch } from '../settings/settings-footer-switch';
import { useCommandTyping } from './use-command-typing';

/**
 * The Commands overview's bottom action bar: the shared floating settings footer (`.editor-footer`,
 * `.overlay-footer`) that the Memory and Automations overviews also use for settings of the whole
 * page, so it stays in reach however long the command list grows. At its trailing edge, the typing
 * effect of commands that write into another app, a switch: on, answers are typed in a few
 * characters at a time; off, they are pasted at once. While the system's Reduce Motion is on,
 * which makes the shell paste every answer at once, its description says so instead.
 */
export function CommandTypingFooter({ settings }: { settings: SettingsSnapshot | null }) {
  const { t } = useTranslation('commands');
  const typing = useCommandTyping(settings);
  const reduceMotion = useReducedMotion() ?? false;
  const footerRef = useOverlayFooter<HTMLElement>();
  return (
    <footer ref={footerRef} className="editor-footer overlay-footer">
      {/* The trailing actions slot, where the other footers keep theirs. */}
      <div className="flex-wrap justify-end">
        <SettingsFooterSwitch
          label={t('typing.label')}
          description={reduceMotion ? t('typing.reduceMotion') : t('typing.description')}
          anchor="command-typing"
          checked={typing.value}
          pending={typing.pending}
          disabled={typing.unavailable}
          // The switch flipping is the feedback; only a failure needs a message.
          onCheckedChange={(checked) => void typing.change(checked)}
        />
      </div>
    </footer>
  );
}
