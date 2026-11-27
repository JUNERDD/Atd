import { DEV_BUILD_FILE, isDevBuild } from '../dev-build.ts';

/** How often a running dev worker reads the build stamp. */
const POLL_MS = 1_000;
/** The build this extension last loaded (a reload starts the build it was made for). */
const LOADED_KEY = 'devBuild.loaded';
/** Tabs whose content script the last reload cut off, to inject again. */
const TABS_KEY = 'devBuild.tabs';

export interface DevReloadDeps {
  /** Tabs with a connected content script now. */
  contentTabs(): number[];
  /** Injects the content script into a tab that lacks one. */
  inject(tabId: number): Promise<boolean>;
  /** Persists pending diagnostics into local storage before `chrome.runtime.reload()`. */
  beforeReload?(): Promise<void>;
}

/**
 * Dev flavor only: the extension reloads itself once `pnpm dev:extension` has rebuilt it
 * (`dev-build.ts`), so a change shows without a trip to chrome://extensions. A reload cuts every
 * content script off (each leaves its page as it found it), so the new worker injects the content
 * script again into the tabs that had one; their pages keep their state. An open panel closes.
 *
 * The stamp is read only while the worker runs. A worker that stopped and wakes on an older build
 * than the one on disk reloads at once, because the build it loaded is kept in storage.
 */
export async function watchDevBuilds(deps: DevReloadDeps, booted: Promise<void>): Promise<void> {
  const stored = await chrome.storage.local.get([LOADED_KEY, TABS_KEY]);
  let cutOff: number[] = Array.isArray(stored[TABS_KEY])
    ? stored[TABS_KEY].filter(Number.isInteger)
    : [];
  let loaded = typeof stored[LOADED_KEY] === 'string' ? stored[LOADED_KEY] : await readBuild();
  if (loaded !== null) await chrome.storage.local.set({ [LOADED_KEY]: loaded });
  await chrome.storage.local.remove(TABS_KEY);

  let reloading = false;
  const check = async (): Promise<boolean> => {
    const build = await readBuild();
    if (reloading || build === null || build === loaded) return reloading;
    reloading = true;
    loaded = build;
    // Tabs not reached yet stay on the list, so a reload right on startup keeps them.
    const tabs = [...new Set([...cutOff, ...deps.contentTabs()])];
    await Promise.all([
      chrome.storage.local.set({ [LOADED_KEY]: build, [TABS_KEY]: tabs }),
      deps.beforeReload?.(),
    ]);
    chrome.runtime.reload();
    return true;
  };
  if (await check()) return;
  setInterval(() => void check(), POLL_MS);

  await booted;
  await Promise.all(cutOff.map((tabId) => deps.inject(tabId)));
  cutOff = [];
}

/** The stamp of the build on disk, or null while there is none (between a build's writes). */
async function readBuild(): Promise<string | null> {
  try {
    const response = await fetch(chrome.runtime.getURL(DEV_BUILD_FILE), { cache: 'no-store' });
    const stamp: unknown = response.ok ? await response.json() : null;
    return isDevBuild(stamp) ? stamp.build : null;
  } catch {
    return null;
  }
}
