import { useTranslation } from 'react-i18next';
import { COMPUTER_TOOL } from '@atd/agent-contracts';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { useComputerProgress } from '../../computer/computer-progress';
import { computerDetails, computerLiveKey, computerStepKey } from './computer-call';
import { useTaskTurns } from './turn-context';

/** What a `computer` row shows in place of the generic title and target. */
export interface ComputerRow {
  title: string;
  /** The target's label once the call names it. */
  target: string | null;
}

/**
 * The row of a `computer` call, null for every other tool. While it runs, the title follows the
 * host's live phase for this run and says Stopping… from the moment the run is stopping until the
 * call settles; once settled it names what the call did. Like every tool row it carries no outcome
 * mark: how an action turned out reads in its detail (computer-body.tsx).
 */
export function useComputerRow(block: BlockOf<'tool'>): ComputerRow | null {
  const { t } = useTranslation('tasks');
  const turns = useTaskTurns();
  const live = block.name === COMPUTER_TOOL && block.status === 'running';
  const progress = useComputerProgress(
    live ? (turns?.taskId ?? null) : null,
    live ? block.runId : null,
  );
  if (block.name !== COMPUTER_TOOL) return null;
  const details = computerDetails(block);
  const stopping = live && turns?.runs.find(({ id }) => id === block.runId)?.status === 'stopping';
  return {
    title: live ? t(computerLiveKey(block, progress, stopping)) : t(computerStepKey(block)),
    target: details?.target ?? null,
  };
}
