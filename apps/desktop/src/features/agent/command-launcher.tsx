import { useState } from 'react';
import { Button } from '@ai/ui/components/button';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { useTranslation } from 'react-i18next';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { shortcutKeys } from '../../lib/shortcuts';
import { CommandIcon } from '../commands/command-icon';

const COLLAPSED_COUNT = 3;

export function CommandLauncher({
  commands,
  onChoose,
}: {
  commands: CommandDefinition[];
  onChoose: (id: string) => void;
}) {
  const { t } = useTranslation('panel');
  const [expanded, setExpanded] = useState(false);
  const available = commands.filter((command) => command.enabled);
  const visible = expanded ? available : available.slice(0, COLLAPSED_COUNT);
  return (
    <div className="quick-commands">
      {visible.map((command) => (
        <Button
          key={command.id}
          variant="ghost"
          className="quick-command"
          onClick={() => onChoose(command.id)}
        >
          <CommandIcon templateId={command.templateId} />
          <span className="quick-command-copy">
            <span title={command.name}>{command.name}</span>
            <small title={command.description}>{command.description}</small>
          </span>
          {command.shortcut && (
            <KbdGroup className="justify-self-end">
              {shortcutKeys(command.shortcut, window.desktop?.platform ?? 'web').map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </KbdGroup>
          )}
        </Button>
      ))}
      {available.length > COLLAPSED_COUNT && (
        <Button
          variant="outline"
          className="col-span-full justify-self-start"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('commands.less') : t('commands.all')}
        </Button>
      )}
    </div>
  );
}
