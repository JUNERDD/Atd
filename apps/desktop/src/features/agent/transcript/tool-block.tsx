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
  fileIconForPath,
  memoryTargetKey,
  outcomeKey,
  statusLabelKey,
  stepKey,
  toolTarget,
} from './tool-copy';

/**
 * One step of the agent's work. In a phase the rail draws the bullet, so the row drops its own
 * leading icon: the verb reads at full strength, the file target sits in a chip, and only failure
 * stays marked with a trailing cross. Running and success get no trailing icon.
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
  const label = stepKey(block.name);
  const title = label ? t(label) : block.name;
  const path =
    (block.name === 'read' || block.name === 'write' || block.name === 'edit') &&
    typeof block.args.path === 'string'
      ? block.args.path
      : null;
  const rawTarget = toolTarget(block.name, block.args);
  const memoryKey = rawTarget ? memoryTargetKey(rawTarget) : null;
  const meta = memoryKey ? t(memoryKey) : (rawTarget ?? t(statusLabelKey(block.status)));
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
      {rejected && <X className="tool-row-error" />}
    </>
  );
  return (
    <div className="tool-block">
      <CollapsibleRow open={expanded} onOpenChange={setOpen} heading={heading}>
        <div className="tool-body">
          <ToolBody block={block} />
        </div>
      </CollapsibleRow>
      {confirmation && <ApprovalControls request={confirmation} />}
      {!confirmation && block.permission?.outcome && (
        <p className="permission-chip">{t(outcomeKey(block.permission.outcome))}</p>
      )}
    </div>
  );
}
