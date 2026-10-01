import { useRef, useState, type ReactElement, type Ref } from 'react';
import { PopoverAnchor } from '@ai/ui/components/popover';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { AgentTask } from '../../client/agent/task-schema';
import type { Connection, ModelReference } from '../../client/providers/schema';
import type { CompactBlock } from '../agent/compaction/compact-availability';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import type { QuickCommandActions } from './quick-commands';
import { QuickPanelSurface } from './quick-panel-surface';
import type { TriggerState } from './trigger';
import { useMentionView } from './use-mention-view';
import { isQuickPanelOpen, type QuickPanelAria, type QuickPanelHandle } from './use-quick-panel';
import { useServiceLists } from './use-service-lists';
import { useSlashView } from './use-slash-view';

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
  /** Why the open task cannot be compacted now (`/compact`); null when it can. */
  compact: CompactBlock | null;
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
 * The composer's `@` / `/` panel (plan 1.4) on the shared `QuickPanelSurface`. The surface
 * matches the composer width, always opens above it, and scrolls inside instead of flipping below
 * the input on short windows.
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
  compact,
  taskId,
  tasks = [],
  children,
  boundary,
}: QuickPanelProps) {
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
    compact,
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
    files: true,
  });
  const view = slash ? slashView : mentionView;

  return (
    <QuickPanelSurface
      open={open}
      view={view}
      enterHint={slash?.placement === 'leading' ? 'use' : 'insert'}
      onDismiss={editor.dismissTrigger}
      handleRef={handleRef}
      onAriaChange={onAriaChange}
      anchor={
        <PopoverAnchor asChild ref={anchor}>
          {children}
        </PopoverAnchor>
      }
      owner={anchor}
      placement={{
        side: 'top',
        collisionBoundary: boundary,
        avoidCollisions: false,
        className: 'quick-panel-content p-0',
      }}
    />
  );
}
