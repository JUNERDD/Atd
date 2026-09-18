import { createElement, useState } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { ConfirmationRequest } from '../../../../electron/agent/permission-schema';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import { ApprovalControls } from './approval-controls';
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
      <ChevronRight className={expanded ? 'rotate-90' : ''} />
    </>
  );
  return (
    <div className="tool-block">
      <Collapsible open={expanded} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="activity-trigger">
            {heading}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="tool-body">
          <ToolBody block={block} />
        </CollapsibleContent>
      </Collapsible>
      {confirmation && <ApprovalControls request={confirmation} />}
      {!confirmation && block.permission?.outcome && (
        <p className="permission-chip">{t(outcomeKey(block.permission.outcome))}</p>
      )}
    </div>
  );
}
