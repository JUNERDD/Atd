import {
  mutationOptions,
  useIsMutating,
  useMutationState,
  type Mutation,
  type QueryKey,
} from '@tanstack/react-query';
import { queryClient } from '../../lib/query-client';
import { readString } from './wire-read';

export function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/**
 * What a write in progress holds: one built-in, skill, role, subagent or MCP server, one plugin,
 * or an install. Rows lock while their own target is busy; pages lock while anything is.
 */
export type ExtensionBusyTarget =
  | { kind: 'builtin' | 'skill' | 'role' | 'agent' | 'mcp'; name: string }
  | { kind: 'plugin'; id: string }
  | { kind: 'install' };

/** Writes that hold their target busy; switches (`SWITCH_KEY`) show their change instead. */
const WRITE_KEY = 'extensionWrite';
export const SWITCH_KEY = 'extensionSwitch';

/** The variables field that names each kind's target. */
const TARGET_FIELD = {
  builtin: 'id',
  skill: 'name',
  role: 'id',
  agent: 'name',
  mcp: 'serverId',
  plugin: 'id',
  install: null,
} as const satisfies Record<ExtensionBusyTarget['kind'], string | null>;

type TargetKind = keyof typeof TARGET_FIELD;
/** Variables of a write on `kind`: an object naming its target in that kind's field. */
type TargetVariables<Kind extends TargetKind> = (typeof TARGET_FIELD)[Kind] extends string
  ? { [field in (typeof TARGET_FIELD)[Kind]]: string }
  : object;

const isTargetKind = (value: unknown): value is TargetKind =>
  typeof value === 'string' && Object.hasOwn(TARGET_FIELD, value);

function busyTargetOf(mutation: Mutation<unknown, Error, unknown>): ExtensionBusyTarget | null {
  const kind = mutation.options.mutationKey?.[1];
  if (!isTargetKind(kind)) return null;
  const { variables } = mutation.state;
  if (kind === 'install') return { kind };
  if (kind === 'plugin') return { kind, id: readString(variables, TARGET_FIELD.plugin) };
  return { kind, name: readString(variables, TARGET_FIELD[kind]) };
}

/**
 * A write that holds its target busy while it runs. Once it succeeds, `reload` lists read again;
 * `awaitReload` keeps the write running until they answer, so the page shows the result as the
 * write finishes (a delete or save leaves its page on a list that already reflects it).
 */
export function extensionWrite<Kind extends TargetKind, Variables extends TargetVariables<Kind>, R>(
  kind: Kind,
  mutationFn: (variables: Variables) => Promise<R>,
  options: { reload?: QueryKey; awaitReload?: boolean; quiet?: boolean } = {},
) {
  const { reload, awaitReload = true, quiet = false } = options;
  return mutationOptions({
    mutationKey: [WRITE_KEY, kind],
    mutationFn,
    onSuccess: () => {
      if (!reload) return;
      const reloaded = queryClient.invalidateQueries({ queryKey: reload });
      return awaitReload ? reloaded : undefined;
    },
    ...(quiet ? { meta: { errorToast: false } as const } : {}),
  });
}

/**
 * The extension writes in progress: `busy` is the target of the latest one still running (rows
 * compare it with their own), `locked` whether any is (pages lock).
 */
export function useExtensionBusy() {
  const targets = useMutationState(
    { filters: { mutationKey: [WRITE_KEY], status: 'pending' }, select: busyTargetOf },
    queryClient,
  );
  const writes = useIsMutating({ mutationKey: [WRITE_KEY] }, queryClient);
  return { busy: targets.findLast((target) => target !== null) ?? null, locked: writes > 0 };
}
