import { Compile } from 'typebox/compile';
import { AppBuildDetailsSchema, type AppBuildDetails } from '@atd/agent-contracts';

const AppBuildDetailsValidator = Compile(AppBuildDetailsSchema);

/**
 * The `app` tool's card: a successful `build` returns the contract's `app` details as is (built
 * by apps/lifecycle.ts); its other operations carry none.
 */
export function projectAppDetails(raw: unknown): AppBuildDetails | undefined {
  return AppBuildDetailsValidator.Check(raw) ? raw : undefined;
}
