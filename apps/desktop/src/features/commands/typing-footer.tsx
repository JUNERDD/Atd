import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'motion/react';
import { ChevronUp } from 'lucide-react';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import { ItemGroup } from '@atd/ui/components/item';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@atd/ui/components/popover';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { SettingsSwitchRow } from '../settings/settings-switch-row';
import { useCommandTyping } from './use-command-typing';

/**
 * The Commands overview's bottom action bar: the shared floating settings footer (`.editor-footer`,
 * `.overlay-footer`) that the Memory and Automations overviews also use for settings of the whole
 * page, so it stays in reach however long the command list grows. At its trailing edge, one glass
 * pop-up button for how commands write into another app: its label and whether typing is on. It
 * opens a popover (`.command-typing-popover`) whose header names the group, says it is in beta and
 * what it applies to, above two switches. Typing: on, answers are typed in a few characters at a
 * time; off, they are pasted at once. The highlight, independent of it: the trace an answer leaves
 * over the field as it lands, typed or pasted at once. Both start off; the first time typing is
 * turned on, the service turns a never-chosen highlight on with it, which the popover shows once
 * the service answers. While the system's Reduce Motion is on, which makes the shell paste every
 * answer at once and keep only the trace's still wash, both descriptions say so instead.
 */
export function CommandTypingFooter({ settings }: { settings: SettingsSnapshot | null }) {
  const { t } = useTranslation('commands');
  const typing = useCommandTyping(settings, 'commandTyping');
  const animation = useCommandTyping(settings, 'commandTypingAnimation');
  const reduceMotion = useReducedMotion() ?? false;
  const footerRef = useOverlayFooter<HTMLElement>();
  const ids = useId();
  return (
    <footer ref={footerRef} className="editor-footer overlay-footer">
      {/* The trailing actions slot, where the other footers keep theirs. */}
      <div className="flex-wrap justify-end">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="glass" data-settings-anchor="command-typing">
              {t('typing.label')}
              <span className="text-muted-foreground">
                {typing.value ? t('typing.state.on') : t('typing.state.off')}
              </span>
              <ChevronUp data-icon="inline-end" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            aria-labelledby={`${ids}-title`}
            aria-describedby={`${ids}-scope`}
            className="command-typing-popover w-88"
          >
            <PopoverHeader>
              <div className="flex items-center gap-2">
                <PopoverTitle id={`${ids}-title`} className="text-sm font-semibold">
                  {t('typing.label')}
                </PopoverTitle>
                <Badge variant="outline">{t('typing.beta')}</Badge>
              </div>
              <PopoverDescription id={`${ids}-scope`}>{t('typing.scope')}</PopoverDescription>
            </PopoverHeader>
            <ItemGroup>
              <SettingsSwitchRow
                id={`${ids}-typing`}
                title={t('typing.switch')}
                description={reduceMotion ? t('typing.reduceMotion') : t('typing.description')}
                checked={typing.value}
                pending={typing.pending}
                disabled={typing.unavailable}
                // The switch flipping is the feedback; only a failure needs a message.
                onCheckedChange={(checked) => void typing.change(checked)}
              />
              <SettingsSwitchRow
                id={`${ids}-animation`}
                title={t('typingAnimation.label')}
                description={
                  reduceMotion
                    ? t('typingAnimation.reduceMotion')
                    : t('typingAnimation.description')
                }
                checked={animation.value}
                pending={animation.pending}
                disabled={animation.unavailable}
                onCheckedChange={(checked) => void animation.change(checked)}
              />
            </ItemGroup>
          </PopoverContent>
        </Popover>
      </div>
    </footer>
  );
}
