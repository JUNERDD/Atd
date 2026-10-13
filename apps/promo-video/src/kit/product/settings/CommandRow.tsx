import { MoreHorizontal, Play, type LucideIcon } from 'lucide-react';
import { IconButton, ShortcutPill, Switch } from './controls.tsx';
import '../tokens.css';
import './command-row.css';

/** A row's height and the gap between rows, in points: an `Item` `sm` in an `ItemGroup`. */
export const COMMAND_ROW_HEIGHT = 69;
export const COMMAND_ROW_GAP = 10;
export const COMMAND_ROW_PITCH = COMMAND_ROW_HEIGHT + COMMAND_ROW_GAP;

export interface CommandRowData {
  icon: LucideIcon;
  name: string;
  description: string;
  /** The shortcut's keycaps; empty when none is set. */
  keys: readonly string[];
  enabled: boolean;
}

interface CommandRowProps {
  command: CommandRowData;
  /** What an unset shortcut's pill reads (`strings[lang].settings.commands.setShortcut`). */
  emptyShortcut: string;
  /** The lift's shadow, 0 → 1: it rises while a press arms the hold, and stays while held. */
  shadow?: number;
  /** Held: the row takes the window's opaque fill and rides above its neighbours. */
  lifted?: boolean;
  /** The pointer rests on the row: the ghost hover wash, which a lifted row drops. */
  hover?: boolean | undefined;
}

/**
 * A command in the Commands list (`command-row.tsx`): an outline `Item` at `sm` with the icon,
 * the name over its muted description, then the fixed columns: the shortcut, Run, the enable
 * Switch and More. A command that is off keeps its columns, with Run at half opacity. Drive a
 * long press with `commandRowHold` (`command-row.ts`); move a lifted row with `Move` or a translate of its own.
 */
export function CommandRow({
  command,
  emptyShortcut,
  shadow = 0,
  lifted = false,
  hover = false,
}: CommandRowProps) {
  const Icon = command.icon;
  return (
    <div
      className="rk-row"
      data-lifted={lifted || undefined}
      data-hover={(hover && !lifted) || undefined}
      style={{ '--shadow': shadow }}
    >
      <div className="rk-row__identity">
        <Icon className="pk-icon rk-row__icon" />
        <div className="rk-row__text">
          <span className="rk-row__title">{command.name}</span>
          <span className="rk-row__description">{command.description}</span>
        </div>
      </div>
      <div className="rk-row__controls">
        <div className="rk-row__shortcut">
          <ShortcutPill keys={command.keys} empty={emptyShortcut} />
        </div>
        <div className="rk-row__actions">
          <IconButton icon={Play} disabled={!command.enabled} />
          <Switch checked={command.enabled} />
          <IconButton icon={MoreHorizontal} />
        </div>
      </div>
    </div>
  );
}
