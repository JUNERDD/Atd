import { useState, type Ref, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { PopoverAnchor } from '@ai/ui/components/popover';
import type { AgentTask } from '../../client/agent/task-schema';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import { QuickPanelSurface } from '../quick-panel/quick-panel-surface';
import type { TriggerState } from '../quick-panel/trigger';
import { useMentionView } from '../quick-panel/use-mention-view';
import type { QuickPanelAria, QuickPanelHandle } from '../quick-panel/use-quick-panel';
import { useServiceLists } from '../quick-panel/use-service-lists';
import { skillsView } from '../quick-panel/use-slash-view';
import { isInstructionChip } from './instruction-chips';

/** The rect the panel follows: the trigger's line across the editor, re-read as it moves. */
interface CaretAnchor {
  getBoundingClientRect(): DOMRect;
  /** Lets the positioning find the editor's scroll containers. */
  contextElement?: Element | undefined;
}

/**
 * The instruction editor's `/` and `@` panel on the composer's `QuickPanelSurface`: `/` lists
 * skills only (quick commands act on a composer draft), `@` lists conversations, MCP servers and
 * subagents but no files, which a command takes at run time through `{{files}}`. It opens below
 * the trigger's line, flips above it when the settings window has more room there, and caps its
 * height to the room left, so it fits short windows; it follows the caret while the form scrolls.
 */
export function InstructionQuickPanel({
  trigger,
  editor,
  handleRef,
  onAriaChange,
  tasks,
  anchor,
  owner,
}: {
  trigger: TriggerState | null;
  editor: ComposerEditorCommands;
  handleRef: Ref<QuickPanelHandle>;
  onAriaChange: (aria: QuickPanelAria | null) => void;
  /** Snapshot tasks: the `@` conversations. */
  tasks: readonly AgentTask[];
  anchor: RefObject<CaretAnchor>;
  owner: RefObject<Element | null>;
}) {
  const { t } = useTranslation('panel');
  const open = trigger !== null;
  // Radix keeps the content mounted while it animates out, so it keeps the last open view.
  const [lastOpen, setLastOpen] = useState<TriggerState | null>(null);
  if (open && trigger !== lastOpen) setLastOpen(trigger);
  const shown = open ? trigger : lastOpen;
  const slash = shown?.kind === 'slash' ? shown : null;
  const mention = shown?.kind === 'mention' ? shown : null;
  const lists = useServiceLists({
    skills: open && slash !== null,
    agents: open && mention !== null,
    mcp: open && mention !== null,
  });
  const mentionView = useMentionView({
    trigger: mention,
    open,
    editor,
    tasks,
    // Commands run outside any task, so no conversation is the current one.
    taskId: null,
    attachmentCount: 0,
    agents: lists.agents,
    mcp: lists.mcp,
    files: false,
    accepts: isInstructionChip,
  });
  const view = slash ? skillsView(lists.skills, slash.query, editor, t) : mentionView;
  return (
    <QuickPanelSurface
      open={open}
      view={view}
      enterHint="insert"
      onDismiss={editor.dismissTrigger}
      handleRef={handleRef}
      onAriaChange={onAriaChange}
      anchor={<PopoverAnchor virtualRef={anchor} />}
      owner={owner}
      placement={{
        side: 'bottom',
        sideOffset: 4,
        hideWhenDetached: true,
        updatePositionStrategy: 'always',
        className: 'quick-panel-content instruction-quick-panel p-0',
      }}
    />
  );
}
