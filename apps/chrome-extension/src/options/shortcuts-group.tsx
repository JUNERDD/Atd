import { useTranslation } from 'react-i18next';
import type { ShortcutView } from '../messages/views.ts';
import { Group, Row } from './group.tsx';
import { shortcutKeys } from './model.ts';
import type { SendOption } from './use-options-channel.ts';

/**
 * A shortcut as Mac keycaps, one per key. Screen readers get the whole shortcut once, as Chrome
 * writes it, rather than key by key.
 */
function Keycaps({ shortcut }: { shortcut: string }) {
  return (
    <span className="op-keys">
      <span className="sr-only">{shortcut}</span>
      <kbd className="op-keycaps" aria-hidden="true">
        {shortcutKeys(shortcut).map((key, index) => (
          <kbd key={`${index}:${key}`} className="op-key">
            {key}
          </kbd>
        ))}
      </kbd>
    </span>
  );
}

/**
 * The extension's command shortcuts, in Chrome's order. Chrome keeps them and only its own shortcut
 * page changes them, so the group shows them and opens that page; the page reads them again when
 * the person comes back (`useOptionsChannel`).
 */
export function ShortcutsGroup({
  shortcuts,
  name,
  send,
}: {
  shortcuts: ShortcutView[];
  /** The extension's name as Chrome lists it on its shortcut page. */
  name: string;
  send: SendOption;
}) {
  const { t } = useTranslation('options');
  // The ask command and the one Chrome adds for the toolbar button, which does what a click does,
  // in Atd's words; any other command by its manifest description.
  const labelOf = (command: ShortcutView): string => {
    if (command.name === 'ask-on-page') return t('shortcuts.ask');
    if (command.name === '_execute_action') return t('shortcuts.action');
    return command.description || command.name;
  };
  return (
    <Group
      title={t('shortcuts.heading')}
      actions={
        <button
          type="button"
          className="btn-bordered op-btn hit-extend"
          onClick={() => send({ type: 'shortcuts.edit' })}
        >
          {t('shortcuts.change')}
        </button>
      }
      footer={<p className="list-footer">{t('shortcuts.footer', { name })}</p>}
    >
      {shortcuts.map((command) => (
        <Row key={command.name} label={labelOf(command)}>
          {command.shortcut ? (
            <Keycaps shortcut={command.shortcut} />
          ) : (
            <span className="list__value">{t('shortcuts.notSet')}</span>
          )}
        </Row>
      ))}
    </Group>
  );
}
