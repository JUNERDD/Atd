import type { AgentEvent, CommandProgressAction } from '../../client/agent/bridge';
import type { LightHost } from './light-command';

/** The single current island content; execution state stays with its run or input card. */
interface IslandContent {
  key: string;
  identity: object;
  /** A running command reusing this hold protects it from its predecessor's late release. */
  holdKey?: string;
  act: (action: CommandProgressAction, host: LightHost) => void;
  supersede: () => void;
  follow?: (event: AgentEvent, host: LightHost) => void;
}

let current: IslandContent | null = null;
let panel: (() => LightHost) | null = null;

export function isCurrentIsland(identity: object): boolean {
  return current?.identity === identity;
}

/** Replacing content clears its ownership before its cancellation can report anything. */
export function replaceIsland(content: IslandContent): void {
  const previous = current;
  current = content;
  previous?.supersede();
}

/** Drops only this content, so an old asynchronous failure cannot clear a newer card. */
export function clearIsland(identity: object | undefined = current?.identity): void {
  if (current?.identity === identity) current = null;
}

export function islandIdentity(): object | null {
  return current?.identity ?? null;
}

export function islandHoldKey(): string | undefined {
  return current?.holdKey;
}

export function actOnIsland(action: CommandProgressAction, host: LightHost): void {
  if (current?.key === action.target) current.act(action, host);
}

/** The committed panel host also handles a waiting state returned directly by submit. */
export function connectIslandHost(host: () => LightHost): () => void {
  panel = host;
  return () => {
    if (panel === host) panel = null;
  };
}

export function followIsland(event: AgentEvent): void {
  if (panel) current?.follow?.(event, panel());
}
