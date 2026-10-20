import { Compile } from 'typebox/compile';
import { ComputerDetailsSchema, type ComputerDetails } from '@atd/agent-contracts';
import { currentComputerDetails } from '../computer/retired.js';

const ComputerDetailsValidator = Compile(ComputerDetailsSchema);

/**
 * The `computer` tool's row: every completed call returns the contract's `computer` details as is
 * (built by computer/details.ts: the operation, target label, step summaries without typed text,
 * the action's result facts and the screenshot resources it saved). An action's refusal reason and
 * the disturbances the host measured travel inside its result (`result.error.reason`,
 * `result.disturbances`). Details written before computer protocol 8 read as they would be
 * written today (`currentComputerDetails`); a retired `flow` row stays unknown and is not shown.
 */
export function projectComputerDetails(raw: unknown): ComputerDetails | undefined {
  const details = currentComputerDetails(raw);
  return ComputerDetailsValidator.Check(details) ? details : undefined;
}
