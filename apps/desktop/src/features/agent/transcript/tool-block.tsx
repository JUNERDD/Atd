import { createElement, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { ConfirmationRequest } from '../../../../electron/agent/permission-schema';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { ApprovalControls } from './approval-controls';
import { CollapsibleRow } from './collapsible-row';
import { ToolBody } from './tool-body';
import {
  commandStepKey,
  fileIconForPath,
  memoryTargetKey,
  outcomeKey,
  statusLabelKey,
  stepKey,
  toolIcon,
  toolTarget,
} from './tool-copy';

/**
 * One step of the agent's work. The leading icon names the tool type and swaps to the expanding
 * chevron on hover (see `CollapsibleRow`); the verb reads at full strength, the file target sits
 * in a chip, and only failure stays marked with a trailing cross. Running and success get no
 * trailing icon. A recorded permission outcome rides the row too — replacing the status fallback
 * when the call has no target — instead of floating on its own line.
 */
export function ToolBlock({
  block,
  confirmation,
  forceOpen,
}: {
  block: BlockOf<'tool'>;
  confirmation?: ConfirmationRequest;
  forceOpen?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(Boolean(forceOpen));
  const expanded = Boolean(forceOpen) || open;
  const Icon = toolIcon(block.name);
  const label = block.name === 'command' ? commandStepKey(block.args) : stepKey(block.name);
  const title = label ? t(label) : block.name;
  const path =
    (block.name === 'read' || block.name === 'write' || block.name === 'edit') &&
    typeof block.args.path === 'string'
      ? block.args.path
      : null;
  const rawTarget = toolTarget(block.name, block.args);
  const memoryKey = rawTarget ? memoryTargetKey(rawTarget) : null;
  const outcome =
    !confirmation && block.permission?.outcome ? t(outcomeKey(block.permission.outcome)) : null;
  const meta = memoryKey ? t(memoryKey) : (rawTarget ?? outcome ?? t(statusLabelKey(block.status)));
  const rejected =
    block.status === 'failed' || block.status === 'declined' || block.status === 'interrupted';
  const heading = (
    <>
      <span className="min-w-0 flex-1 truncate text-left" title={block.name}>
        {block.status === 'running' ? <Shimmer as="span">{title}</Shimmer> : title}
      </span>
      {path ? (
        <span className="tool-chip" title={meta}>
          {createElement(fileIconForPath(path))}
          {meta}
        </span>
      ) : (
        <span className="activity-meta" title={meta}>
          {meta}
        </span>
      )}
      {outcome && meta !== outcome && (
        <span className="permission-chip" title={outcome}>
          {outcome}
        </span>
      )}
      {rejected && <X className="tool-row-error" />}
    </>
  );
  return (
    <div className="tool-block">
      <CollapsibleRow
        open={expanded}
        onOpenChange={setOpen}
        icon={<Icon className="row-icon" strokeWidth={1.75} />}
        heading={heading}
      >
        <div className="tool-body">
          <ToolBody block={block} />
        </div>
      </CollapsibleRow>
      {confirmation && <ApprovalControls request={confirmation} />}
    </div>
  );
}
