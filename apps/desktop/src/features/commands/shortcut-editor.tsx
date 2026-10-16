import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Trash2 } from 'lucide-react';
import { isBlankShortcut, type CommandShortcut } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { Input } from '@atd/ui/components/input';
import { ItemGroup } from '@atd/ui/components/item';
import { Label } from '@atd/ui/components/label';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { shortcutProblem } from '../../client/agent/shortcut-validation';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { useOverlayFooter } from '../../components/use-overlay-footer';
import { useAgent } from '../agent/use-agent';
import { SettingsGroup } from '../settings/settings-group';
import { SettingsHeading } from '../settings/settings-heading';
import { useSettingsUnsavedChanges } from '../settings/settings-unsaved-changes';
import { shortcutProblemText } from './command-problem';
import { CommandShortcutRow } from './shortcut-input';
import { plainShortcut } from './shortcut-drafts';
import { useShortcutNames } from './shortcut-names';
import { ShortcutOverrideFields } from './shortcut-override-fields';
import { useShortcutContext } from './use-command-problems';

const KEYS_ERROR_ID = 'shortcut-keys-error';

/**
 * One shortcut's page over the command editor, laid out like a parameter's page: its keys, its
 * name (empty takes the name made from its overrides), then what a run from it does differently
 * (`ShortcutOverrideFields`). Done checks the shortcut as part of the command and hands it back to
 * the editor's draft, which the editor's own Save then stores; Delete removes it from the draft.
 * A new shortcut's page starts recording its keys at once, and one left with nothing set adds
 * nothing.
 */
export function ShortcutEditor({
  initial,
  command,
  settings,
  onDone,
  onDelete,
  onCancel,
}: {
  /** The shortcut being edited, or null for a new one. */
  initial: CommandShortcut | null;
  /** The editor's draft, which holds `initial` when it is not new. */
  command: CommandDefinition;
  settings: SettingsSnapshot | null;
  onDone: (shortcut: CommandShortcut) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('commands');
  const { t: tSettings } = useTranslation('settings');
  const names = useShortcutNames();
  const context = useShortcutContext(settings);
  const registration = useAgent().snapshot?.shortcutErrors ?? {};
  const [start] = useState(() => initial ?? plainShortcut(''));
  const [draft, setDraft] = useState(start);
  useSettingsUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(start));
  const [error, setError] = useState<{ keys: boolean; text: string } | null>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const footerRef = useOverlayFooter<HTMLElement>();
  function done() {
    if (!initial && isBlankShortcut(draft)) return onCancel();
    const next = {
      ...command,
      shortcuts: initial
        ? command.shortcuts.map((item) => (item.id === draft.id ? draft : item))
        : [...command.shortcuts, draft],
    };
    const problem = shortcutProblem(next, draft, context);
    if (!problem) return onDone(draft);
    const labels = { t, tSettings, names, command: next, commands: context.commands };
    const keys = problem.code === 'invalidKeys' || problem.code === 'conflict';
    setError({ keys, text: shortcutProblemText(problem, labels) });
    requestAnimationFrame(() =>
      (keys ? document.getElementById(KEYS_ERROR_ID) : errorMessage.current)?.scrollIntoView({
        block: 'nearest',
      }),
    );
  }
  // A failed registration belongs to the keys it was registered with.
  const registered = initial && draft.accelerator === initial.accelerator;
  const keysError =
    (error?.keys ? error.text : '') || (registered ? (registration[draft.id] ?? '') : '');
  return (
    <section className="command-editor">
      <SettingsHeading
        title={initial ? t('shortcut.page.editTitle') : t('shortcut.page.newTitle')}
        description={t('shortcut.page.subtitle', { name: command.name || t('editor.newTitle') })}
        subpage
        backLabel={t('shortcut.page.back')}
      />
      <ScrollArea
        className="settings-page-scroll"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
      >
        <div className="editor-fields settings-groups min-w-0 p-0.75">
          <Card size="sm" className="settings-card">
            <ItemGroup aria-label={t('shortcut.page.keys')}>
              <CommandShortcutRow
                id="shortcut-keys"
                title={t('shortcut.page.keys')}
                description={t('shortcut.page.keysDescription')}
                accelerator={draft.accelerator}
                recordLabel={t('shortcut.record')}
                error={keysError}
                errorId={KEYS_ERROR_ID}
                autoRecord={!initial}
                onRecorded={(accelerator) => {
                  setDraft((current) => ({ ...current, accelerator }));
                  setError(null);
                }}
                remove={
                  draft.accelerator
                    ? {
                        label: t('shortcut.clear'),
                        ariaLabel: t('shortcut.clear'),
                        onClick: () => setDraft({ ...draft, accelerator: '' }),
                      }
                    : undefined
                }
              />
            </ItemGroup>
          </Card>
          <div className="settings-field">
            <Label htmlFor="shortcut-name">{t('shortcut.page.name')}</Label>
            <Input
              id="shortcut-name"
              value={draft.name}
              maxLength={120}
              placeholder={names.generated(command, draft)}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <SettingsGroup
            id="shortcut-overrides"
            title={t('shortcut.page.overridesTitle')}
            description={t('shortcut.page.overridesDescription')}
          >
            <ShortcutOverrideFields
              command={command}
              shortcut={draft}
              settings={settings}
              onChange={(shortcut) => {
                setDraft(shortcut);
                if (!error?.keys) setError(null);
              }}
            />
          </SettingsGroup>
          {error && !error.keys && (
            <p ref={errorMessage} role="alert" className="settings-inline-error">
              <CircleAlert aria-hidden />
              {error.text}
            </p>
          )}
          <p className="settings-field-note">{t('shortcut.page.footerNote')}</p>
        </div>
      </ScrollArea>
      <footer ref={footerRef} className="editor-footer overlay-footer">
        <div>
          {initial && (
            <Button variant="glass" onClick={onDelete}>
              <Trash2 data-icon="inline-start" />
              {t('shortcut.row.remove')}
            </Button>
          )}
        </div>
        <div>
          <Button variant="glass" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button onClick={done}>{t('shortcut.page.done')}</Button>
        </div>
      </footer>
    </section>
  );
}
