import { useState, type ReactNode } from 'react';
import { Button } from '@atd/ui/components/button';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { useTranslation } from 'react-i18next';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { keyedShortcuts } from '@atd/agent-contracts';
import { shortcutKeys } from '../../lib/shortcuts';
import { CommandIcon } from '../commands/command-icon';

const COLLAPSED_COUNT = 3;

/**
 * The keys of the command's first shortcut that has some, or nothing. The launcher runs the
 * command with its own settings, which that shortcut may override; the keys only say how else
 * to start it.
 */
function FirstShortcut({ command }: { command: CommandDefinition }) {
  const first = keyedShortcuts(command)[0];
  if (!first) return null;
  return (
    <KbdGroup className="justify-self-end">
      {shortcutKeys(first.accelerator, window.desktop?.platform ?? 'web').map((key, index) => (
        <Kbd key={`${index}-${key}`}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

/**
 * The new task's quick commands: the first few enabled ones, then a wrapping row of outline
 * buttons that browse further, All commands first. `children` adds buttons to that row, such as
 * Create app and My apps.
 */
export function CommandLauncher({
  commands,
  onChoose,
  children,
}: {
  commands: CommandDefinition[];
  onChoose: (id: string) => void;
  children?: ReactNode;
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
          <FirstShortcut command={command} />
        </Button>
      ))}
      {(available.length > COLLAPSED_COUNT || children) && (
        <div className="col-span-full flex flex-wrap gap-2">
          {available.length > COLLAPSED_COUNT && (
            <Button
              variant="outline"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? t('commands.less') : t('commands.all')}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
