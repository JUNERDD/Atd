import type { SendFrame } from './native.ts';
import type { Store } from './store.ts';
import { webOrigin } from './urls.ts';

export interface SiteDeps {
  store: Store;
  /** Sends frames that need Atd: dropped while the channel is not ready. */
  forward: SendFrame;
}

/**
 * A website's permission (D6), from the panel's site switch or the options page's list: sent to
 * Atd and shown at once; Atd's `sites` frame that follows is the truth. Only an http(s) origin,
 * exactly as `URL.origin` writes it, is a site, and nothing changes while Atd cannot take it.
 */
export function setSite(deps: SiteDeps, origin: string, allowed: boolean): void {
  if (webOrigin(origin)?.origin !== origin || !deps.forward({ t: 'site.set', origin, allowed }))
    return;
  const others = deps.store.state.sites.filter((site) => site !== origin);
  deps.store.update({ sites: allowed ? [...others, origin] : others });
}
