import { useRef } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Copy, KeyboardOff, MoreHorizontal, Pencil, Play, Trash2, Zap } from 'lucide-react';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { Switch } from '@atd/ui/components/switch';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import type { FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { IconButton } from '../../components/icon-button';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import { agentApi } from '../agent/use-agent';
import { showErrorToast } from '../../components/toast-store';
import { needsPresence } from '../automations/automation-draft';
import { useOpenSettingsAutomation } from '../settings/settings-navigation';
import { CommandIcon } from './command-icon';
import { useCommandShortcutCapture } from './use-command-shortcut-capture';
import { useLongPressDrag } from './use-long-press-drag';
import '../../components/open-row.css';

export type CommandMatch = FieldsMatch<'name' | 'description'> | null;

export interface CommandRowActions {
  /** Opens the editor; a plugin command opens it read-only. */
  onOpen: (command: CommandDefinition) => void;
  onToggle: (command: CommandDefinition, enabled: boolean) => void;
  /** Saves a shortcut recorded on the row; an empty one removes it. */
  onShortcut: (command: CommandDefinition, shortcut: string) => void;
  /** A Personal copy: a plain copy of the user's command, or Duplicate to Personal for a plugin's. */
  onDuplicate: (command: CommandDefinition) => void;
  onDelete: (command: CommandDefinition) => void;
}

/** A user's command's place in their order; plugin rows have none. */
export interface CommandRowOrder {
  /** False while the list is filtered or holds one command: a long press then does nothing. */
  movable: boolean;
  /** The line that says how to reorder, which describes the row while it can move. */
  hintId: string | undefined;
  /** The drag ended: commit the order the list now shows. */
  onDrop: () => void;
  /** Option-arrow keys on the focused row move the command a place up or down. */
  onMove: (offset: -1 | 1) => void;
}

/** Siblings make way and the dropped row settles with a short ease, not a trailing spring. */
const SETTLE = { duration: 0.15, ease: 'easeOut' } as const;

/**
 * One row anatomy for every command: identity, shortcut, then Run, the enable Switch and More in
 * fixed positions. A long press on the user's own command lifts it to drag within their order,
 * and Option-arrow keys on the focused row move it; a short click still opens the editor. The
 * user's own command records a new shortcut when its shortcut is clicked,
 * and More removes a set one, so no action appears beside the keys to shift the columns. A plugin
 * command keeps the same columns with its shortcut read-only; its More menu narrows to Duplicate
 * to Personal, since it cannot be edited or deleted.
 */
export function CommandRow({
  command,
  match,
  busy,
  shortcutError,
  order,
  onOpen,
  onToggle,
  onShortcut,
  onDuplicate,
  onDelete,
}: {
  command: CommandDefinition;
  match: CommandMatch;
  /** The command is saving: its controls stay focusable but ignore input. */
  busy: boolean;
  shortcutError: string | undefined;
  order: CommandRowOrder | undefined;
} & CommandRowActions) {
  const { t } = useTranslation('commands');
  const { t: tAutomations } = useTranslation('automations');
  const automate = useOpenSettingsAutomation();
  // A command that reads the selection, the clipboard or a screenshot needs someone there, so it
  // is never offered as an automation.
  const automatable = !needsPresence(command);
  const plugin = Boolean(command.pluginId);
  const recorder = useCommandShortcutCapture((shortcut) => onShortcut(command, shortcut));
  const { capture, platform } = recorder;
  const keys = command.shortcut ? shortcutKeys(command.shortcut, platform) : [];
  // A combination the row cannot use outranks the standing registration error.
  const error = recorder.error || shortcutError;
  const drag = useDragControls();
  const hold = useLongPressDrag(drag, Boolean(order?.movable));
  const open = useRef<HTMLButtonElement>(null);
  const content = (
    <>
      {/* A click anywhere on the row opens the editor, like the memory and skill rows;
            the run, enable and More controls stay interactive above this button. */}
      <button
        ref={open}
        type="button"
        className="open-row-button"
        aria-label={
          plugin
            ? t('list.viewFor', { name: command.name })
            : t('list.editFor', { name: command.name })
        }
        aria-keyshortcuts={order ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
        aria-describedby={order?.hintId}
        {...hold.handlers}
        onClick={() => {
          if (!hold.consumeHold()) onOpen(command);
        }}
        onKeyDown={(event) => {
          const offset = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
          if (!order?.movable || !offset || !event.altKey) return;
          event.preventDefault();
          order.onMove(offset);
          // React may move this row's node to reorder the list, which drops its focus.
          requestAnimationFrame(() => open.current?.focus());
        }}
      />
      <div className="command-row-identity">
        <ItemMedia variant="icon">
          <CommandIcon templateId={command.templateId} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>
            <HighlightedText text={command.name} ranges={match?.ranges.name} />
          </ItemTitle>
          <ItemDescription>
            <HighlightedText text={command.description} ranges={match?.ranges.description} />
          </ItemDescription>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </ItemContent>
      </div>
      <div className="command-row-controls">
        <div className="command-row-shortcut">
          {!plugin ? (
            <ShortcutRecorder
              keys={keys}
              recording={capture.isRecording}
              doubleTap={platform === 'darwin'}
              emptyText={t('list.setShortcut')}
              aria-label={
                capture.isRecording
                  ? t('list.shortcutCancelFor', { name: command.name })
                  : t('list.shortcutFor', { name: command.name })
              }
              aria-disabled={busy || undefined}
              aria-busy={busy || undefined}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onBlur={capture.cancel}
              onClick={() => {
                if (busy) return;
                if (capture.isRecording) capture.cancel();
                else capture.start();
              }}
            />
          ) : keys.length ? (
            <KbdGroup>
              {keys.map((key, index) => (
                <Kbd key={`${index}-${key}`}>{key}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            <span className="text-xs text-muted-foreground">{t('list.noShortcut')}</span>
          )}
        </div>
        <ItemActions className="shrink-0">
          {/* Off or saving, Run stays focusable so its tooltip can say why it does nothing. */}
          <IconButton
            label={command.enabled ? t('list.run') : t('list.runOff')}
            aria-label={t('list.runFor', { name: command.name })}
            aria-disabled={!command.enabled || busy || undefined}
            aria-busy={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!command.enabled || busy) return;
              void agentApi()
                .launch(command.id)
                .catch((error) => showErrorToast(error));
            }}
          >
            <Play />
          </IconButton>
          <Switch
            aria-label={t('list.enableFor', { name: command.name })}
            checked={command.enabled}
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onCheckedChange={(enabled) => {
              if (!busy) onToggle(command, enabled);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={t('list.more')}
                aria-label={t('list.moreActionsFor', { name: command.name })}
                tooltipDismissOnClick
              >
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {plugin ? (
                <>
                  <DropdownMenuItem onSelect={() => onDuplicate(command)}>
                    <Copy />
                    {t('list.duplicateToPersonal')}
                  </DropdownMenuItem>
                  {automatable && (
                    <DropdownMenuItem onSelect={() => automate({ commandId: command.id })}>
                      <Zap />
                      {tAutomations('command.automate')}
                    </DropdownMenuItem>
                  )}
                </>
              ) : (
                <>
                  <DropdownMenuItem onSelect={() => onOpen(command)}>
                    <Pencil />
                    {t('common.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDuplicate(command)}>
                    <Copy />
                    {t('list.duplicate')}
                  </DropdownMenuItem>
                  {/* A new automation that runs this command, opened in Automations. */}
                  {automatable && (
                    <DropdownMenuItem onSelect={() => automate({ commandId: command.id })}>
                      <Zap />
                      {tAutomations('command.automate')}
                    </DropdownMenuItem>
                  )}
                  {command.shortcut ? (
                    <DropdownMenuItem disabled={busy} onSelect={() => onShortcut(command, '')}>
                      <KeyboardOff />
                      {t('list.removeShortcut')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onDelete(command)}>
                    <Trash2 />
                    {t('common.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </div>
    </>
  );
  return (
    <Item
      asChild
      size="sm"
      variant="outline"
      className="command-management-row open-row"
      data-hold={order ? hold.phase : undefined}
    >
      {order ? (
        <Reorder.Item
          value={command.id}
          dragListener={false}
          dragControls={drag}
          transition={SETTLE}
          {...hold.item}
          onDragEnd={order.onDrop}
        >
          {content}
        </Reorder.Item>
      ) : (
        <li>{content}</li>
      )}
    </Item>
  );
}
