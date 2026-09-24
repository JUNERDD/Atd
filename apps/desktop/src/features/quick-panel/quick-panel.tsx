import { useRef, useState, type ReactElement, type Ref, type RefCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@ai/ui/components/command';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { Popover, PopoverAnchor, PopoverContent } from '@ai/ui/components/popover';
import type { RunPolicy } from '../../../electron/agent/run-policy';
import type { AgentTask } from '../../../electron/agent/task-schema';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import type { QuickCommandActions } from './quick-commands';
import { visibleGroups, type QuickOption } from './quick-options';
import type { TriggerState } from './trigger';
import { useMentionView } from './use-mention-view';
import {
  isQuickPanelOpen,
  useQuickPanel,
  type QuickPanelAria,
  type QuickPanelHandle,
} from './use-quick-panel';
import { useServiceLists } from './use-service-lists';
import { useSlashView } from './use-slash-view';
import './quick-panel.css';

export interface QuickPanelProps {
  trigger: TriggerState | null;
  /** Active run: `@` and an inline `/` stay closed; a leading `/` lists quick commands only. */
  running: boolean;
  /** Approvals, questions or queued messages wait in the popover `/queue` reopens. */
  pending: boolean;
  editor: ComposerEditorCommands;
  handleRef: Ref<QuickPanelHandle>;
  /** Combobox wiring for the editor content; null while closed. */
  onAriaChange: (aria: QuickPanelAria | null) => void;
  actions: QuickCommandActions;
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  connections: Connection[];
  model: ModelReference | null;
  /** `draft.files` plus file chips, against the 10-file limit. */
  attachmentCount: number;
  /** The current task, excluded from `@` conversations. */
  taskId: string | null;
  /** Snapshot tasks: `@` conversations and recently attached files. */
  tasks?: readonly AgentTask[];
  /** `.composer-surface`; the panel anchors to it without adding a trigger. */
  children: ReactElement;
  /**
   * The panel body below the header. Its top edge caps the panel's height, so the panel never
   * covers the header's drag region or the macOS traffic lights. Null falls back to the viewport.
   */
  boundary: Element | null;
}

/**
 * The `@` / `/` panel above the composer surface (plan 1.4). Focus never leaves the editor: it
 * forwards ↑ ↓ Enter Tab through `handleRef`, the content refuses focus (no auto-focus, mousedown
 * cancelled), and Esc closes the panel in Radix's dismissable layer before the panel-level Esc
 * sees it. The surface matches the composer width, always opens above it, and scrolls inside
 * instead of flipping below the input on short windows.
 */
export function QuickPanel({
  trigger,
  running,
  pending,
  editor,
  handleRef,
  onAriaChange,
  actions,
  policy,
  onPolicyChange,
  connections,
  model,
  attachmentCount,
  taskId,
  tasks = [],
  children,
  boundary,
}: QuickPanelProps) {
  const { t } = useTranslation('panel');
  const anchor = useRef<HTMLDivElement>(null);
  const open = isQuickPanelOpen(trigger, running);
  // Radix keeps the content mounted while it animates out, so it keeps the last open view.
  const [lastOpen, setLastOpen] = useState<TriggerState | null>(null);
  if (open && trigger !== lastOpen) setLastOpen(trigger);
  const shown = open ? trigger : lastOpen;
  const slash = shown?.kind === 'slash' ? shown : null;
  const mention = shown?.kind === 'mention' ? shown : null;
  const lists = useServiceLists({
    skills: open && slash !== null && slash.drill === null && !running,
    agents: open && mention !== null,
    mcp: open && mention !== null,
  });
  const slashView = useSlashView({
    trigger: slash,
    running,
    pending,
    editor,
    actions,
    policy,
    onPolicyChange,
    connections,
    model,
    skills: lists.skills,
  });
  const mentionView = useMentionView({
    trigger: mention,
    open,
    editor,
    tasks,
    taskId,
    attachmentCount,
    agents: lists.agents,
    mcp: lists.mcp,
  });
  const view = slash ? slashView : mentionView;
  const groups = visibleGroups(view.groups);
  // Only the trailing "Browse files…" group has no heading; it is an action, not a result.
  const empty = groups.some((group) => group.heading !== undefined) ? null : view.empty;
  const { activeValue, hover, setList, trackOption } = useQuickPanel({
    open,
    groups,
    handleRef,
    onAriaChange,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) editor.dismissTrigger();
      }}
    >
      <PopoverAnchor asChild ref={anchor}>
        {children}
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionBoundary={boundary}
        collisionPadding={8}
        avoidCollisions={false}
        className="quick-panel-content p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (!event.isComposing) editor.dismissTrigger();
        }}
        onInteractOutside={(event) => {
          // Clicks in the editor move the caret; the trigger under it decides whether to stay open.
          if (event.target instanceof Node && anchor.current?.contains(event.target))
            event.preventDefault();
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Command
          shouldFilter={false}
          value={activeValue}
          onValueChange={hover}
          className="min-h-0 bg-transparent"
        >
          <CommandList
            ref={setList}
            label={t('quickPanel.listLabel')}
            className="max-h-none min-h-0 flex-1"
          >
            {empty !== null && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p>
            )}
            {groups.flatMap((group, index) => [
              // The heading-less "Browse files…" group is set apart from whatever precedes it.
              !group.heading && (index > 0 || empty !== null) && (
                <CommandSeparator key={`${group.id}:rule`} alwaysRender />
              ),
              <CommandGroup
                key={group.id}
                value={group.id}
                heading={
                  group.heading === undefined ? undefined : (
                    <HighlightedText text={group.heading} ranges={group.headingRanges} />
                  )
                }
              >
                {group.notice && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{group.notice}</p>
                )}
                {group.options.map((option) => (
                  <QuickRow key={option.value} option={option} track={trackOption(option.value)} />
                ))}
              </CommandGroup>,
            ])}
          </CommandList>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              {t('quickPanel.hints.choose')}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>Enter</Kbd>
              {slash?.placement === 'leading'
                ? t('quickPanel.hints.use')
                : t('quickPanel.hints.insert')}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>Esc</Kbd>
              {t('quickPanel.hints.close')}
            </span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Icon, title and one-line secondary text (query matches emphasized), trailing status. */
function QuickRow({
  option,
  track,
}: {
  option: QuickOption;
  /** Registers the option element so its id can become `aria-activedescendant`. */
  track: RefCallback<HTMLDivElement>;
}) {
  return (
    <CommandItem
      ref={track}
      value={option.value}
      disabled={option.disabled}
      data-checked={option.checked}
      onSelect={option.select}
    >
      {option.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={option.title}>
          <HighlightedText text={option.title} ranges={option.ranges?.title} />
        </span>
        {option.description && (
          <span className="truncate text-xs text-muted-foreground" title={option.description}>
            <HighlightedText text={option.description} ranges={option.ranges?.description} />
          </span>
        )}
      </span>
      {/* The item's trailing slot: it replaces the hidden check, so statuses sit flush right. */}
      {option.status && (
        <CommandShortcut
          className="max-w-2/5 shrink-0 truncate tracking-normal"
          title={option.status}
        >
          {option.status}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
