import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { ConfirmationRequest } from '../../../client/agent/permission-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { ActivityRow } from './activity-row';
import { PermissionNote, ToolBody } from './tool-body';
import {
  hasToolDetail,
  memoryTargetKey,
  outcomeKey,
  statusLabelKey,
  toolIcon,
  toolStepKey,
  toolTarget,
} from './tool-copy';

/** Tools whose target is a file or search subject, shown as the read-style chip. */
const CHIP_TOOLS: ReadonlySet<string> = new Set(['read', 'write', 'edit', 'grep', 'find', 'ls']);

/**
 * One step of the agent's work. The leading icon names the tool type and swaps to the expanding
 * chevron on hover (see `ActivityRow.Icon`); the verb reads at full strength, the file target sits
 * in a chip, and no trailing status icon is rendered — the row reads the same settled or failed.
 * A recorded permission outcome reads in the row's detail, which it makes expandable on its own;
 * the row shows only a decline, since rows carry no failure mark and it says why nothing ran.
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
  const label = toolStepKey(block.name, block.args);
  const title = label ? t(label) : block.name;
  const target = toolTarget(block.name, block.args);
  // What the call looked at or changed — a file, a search pattern, a folder — sits in a chip.
  const chip = CHIP_TOOLS.has(block.name) && target !== null;
  // A refused launch still names its agents, so the row keeps the failure beside them: the group
  // title leaves the call out of its dispatch count and the row must not read as a launch.
  const rawTarget =
    target && block.name === 'subagent' && block.status === 'failed'
      ? `${target} · ${t(statusLabelKey(block.status))}`
      : target;
  const memoryKey = rawTarget ? memoryTargetKey(rawTarget) : null;
  const outcome = confirmation ? undefined : block.permission?.outcome;
  // A decline is the one outcome the row keeps, standing in for a missing target when there is one.
  const declined = outcome === 'declined' ? t(outcomeKey(outcome)) : null;
  // A pending approval reads as tool name plus waiting text; the decision lives in the composer
  // popover. Settled calls carry a decline on the row and every outcome in the detail.
  const waiting = confirmation ? t('permission.waitingApproval') : null;
  const meta =
    waiting ??
    (memoryKey ? t(memoryKey) : (rawTarget ?? declined ?? t(statusLabelKey(block.status))));
  const mark =
    declined && meta !== declined ? (
      <ActivityRow.Meta className="permission-chip" title={declined}>
        {declined}
      </ActivityRow.Meta>
    ) : null;
  const running = block.status === 'running';
  // While running the whole line reads as one live unit: the meta joins the title inside a
  // single shimmer via plain string concatenation, instead of sitting beside it as static
  // text. Settled rows keep the split title/meta layout below.
  const heading =
    running && meta ? (
      <>
        <ActivityRow.Title className="flex-initial" title={block.name}>
          <Shimmer as="span">{`${title} ${meta}`}</Shimmer>
        </ActivityRow.Title>
        {mark}
      </>
    ) : (
      <>
        {/*
         * `flex-initial` overrides the generic `flex-1` title so it hugs the verb; the summary meta
         * is itself `flex: 1` (see `agent.css`) and fills the rest of the row at the same text size.
         * Both truncate, and the title shrinks first on narrow rows.
         */}
        <ActivityRow.Title className="flex-initial" title={block.name}>
          {running ? <Shimmer as="span">{title}</Shimmer> : title}
        </ActivityRow.Title>
        {chip ? (
          // No file glyph here: the row's leading icon already names the tool.
          <ActivityRow.Meta className="tool-chip" title={meta}>
            {meta}
          </ActivityRow.Meta>
        ) : (
          <ActivityRow.Meta className="activity-meta" title={meta}>
            {meta}
          </ActivityRow.Meta>
        )}
        {mark}
      </>
    );
  // No detail to expand into: the same row frame without a trigger, so hover offers no
  // expanding chevron. The icon box keeps its geometry via `chevron={false}`.
  if (!hasToolDetail(block) && !outcome) {
    return (
      <div className="tool-block">
        <ActivityRow.Root status={block.status}>
          <div className="activity-row-static">
            <ActivityRow.Icon chevron={false}>
              {createElement(Icon, { className: 'row-icon', strokeWidth: 1.75 })}
            </ActivityRow.Icon>
            {heading}
          </div>
        </ActivityRow.Root>
      </div>
    );
  }
  return (
    <div className="tool-block">
      <ActivityRow.Root open={expanded} onOpenChange={setOpen} status={block.status}>
        <ActivityRow.Trigger>
          <ActivityRow.Icon>
            {createElement(Icon, { className: 'row-icon', strokeWidth: 1.75 })}
          </ActivityRow.Icon>
          {heading}
        </ActivityRow.Trigger>
        <ActivityRow.Content>
          <ActivityRow.Body className="tool-body">
            <ToolBody block={block} />
            {outcome && <PermissionNote outcome={outcome} />}
          </ActivityRow.Body>
        </ActivityRow.Content>
      </ActivityRow.Root>
    </div>
  );
}
