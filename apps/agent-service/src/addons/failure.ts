import { errorMessage, type AddonErrorCode } from '@atd/agent-contracts';

/** The longest message an add-on view carries (`AddonView.error.message`). */
const MAX_MESSAGE = 500;

/** Why an install or removal stopped; `code` and `message` become the add-on view's `error`. */
export class AddonFailure extends Error {
  constructor(
    readonly code: AddonErrorCode,
    message: string,
  ) {
    super(message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message);
    this.name = 'AddonFailure';
  }

  /** The add-on view's `error`. */
  view(): { code: AddonErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/** File system errors that mean the disk refused the write, not that the archive was wrong. */
const DISK_CODES = new Set(['ENOSPC', 'EDQUOT', 'EACCES', 'EPERM', 'EROFS', 'EIO', 'EMFILE']);

/**
 * Classifies anything an install threw: an abort is `cancelled` (the caller's signal decides, so
 * a stalled download that aborted itself stays a network failure), a refused write is `disk`, and
 * anything unexpected is `internal`.
 */
export function toAddonFailure(error: unknown, signal: AbortSignal): AddonFailure {
  if (signal.aborted) return new AddonFailure('cancelled', 'The install was cancelled.');
  if (error instanceof AddonFailure) return error;
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && DISK_CODES.has(code))
    return new AddonFailure(
      'disk',
      `The add-on could not be written to disk: ${errorMessage(error)}`,
    );
  return new AddonFailure('internal', `The add-on could not be installed: ${errorMessage(error)}`);
}
