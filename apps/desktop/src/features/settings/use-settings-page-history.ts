import { useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import {
  SettingsPageHistoryContext,
  SettingsSectionActiveContext,
  useSettingsSectionExit,
  type SettingsPageControls,
} from './settings-navigation';

/** The pages Back returns through (oldest first), the shown page, and those Forward reopens. */
interface PageHistory<Route> {
  past: readonly Route[];
  route: Route;
  future: readonly Route[];
}

const start = <Route>(root: Route): PageHistory<Route> => ({ past: [], route: root, future: [] });

function stepBack<Route>(history: PageHistory<Route>): PageHistory<Route> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    route: previous,
    future: [history.route, ...history.future],
  };
}

/**
 * One settings section's page history, like a browser tab's. `root` is the section's overview;
 * opening a sub-page (an editor, a details page) records it and drops the pages Forward could
 * return to. While the section is shown, the window's header Back and Forward step through it;
 * leaving the section returns it to `root` with no history. Switching sections is not recorded.
 *
 * Entries are routes, not page state: a page's unsaved edits end when Back leaves it, and Forward
 * reopens it afresh. `available` says whether a route's entity (a command, a plugin) still exists,
 * so Forward stays off for a deleted one; it returns true while that data is loading. The shown
 * route's entity is the section's to check, as `discard` does for one that is gone.
 *
 * Routes are compared by identity: `leave` and `replace` take the route an asynchronous answer (a
 * save) belongs to, so it cannot move a page the user has left in the meantime.
 */
export function useSettingsPageHistory<Route extends object>(
  root: Route,
  available: (route: Route) => boolean = () => true,
) {
  const [history, setHistory] = useState(() => start(root));
  useSettingsSectionExit(() => setHistory(start(root)));

  const open = useCallback((next: Route) => {
    setHistory(({ past, route }) => ({ past: [...past, route], route: next, future: [] }));
  }, []);
  /** Returns to the previous page, which is what the header's Back and a page's Cancel do. */
  const back = useCallback(() => setHistory(stepBack), []);
  /** Returns to the previous page while `from` is still the shown one, as after a save. */
  const leave = useCallback((from: Route) => {
    setHistory((current) => (current.route === from ? stepBack(current) : current));
  }, []);
  /**
   * Swaps the shown page for `next` (with `from`, only while `from` is shown), as an install lands
   * on the plugin it installed. The root is never replaced: there `next` opens instead.
   */
  const replace = useCallback((next: Route, from?: Route) => {
    setHistory((current) => {
      if (from !== undefined && from !== current.route) return current;
      if (!current.past.length) return { past: [current.route], route: next, future: [] };
      return { ...current, route: next };
    });
  }, []);
  /** Leaves a page whose entity is gone: steps back and drops it, so Forward cannot reopen it. */
  const discard = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1);
      if (previous === undefined) return current;
      return { past: current.past.slice(0, -1), route: previous, future: [] };
    });
  }, []);
  /**
   * Returns to the root and opens each page of `path` in turn, as a search hit enters at an item
   * with its plugin's page behind it.
   */
  const reset = useCallback(
    (...path: Route[]) => {
      const route = path.at(-1);
      setHistory(
        route === undefined
          ? start(root)
          : { past: [root, ...path.slice(0, -1)], route, future: [] },
      );
    },
    [root],
  );
  const next = history.future[0];
  const canGoForward = next !== undefined && available(next);
  function forward() {
    setHistory((current) => {
      const route = current.future[0];
      if (route === undefined || !available(route)) return current;
      return { past: [...current.past, current.route], route, future: current.future.slice(1) };
    });
  }

  useHeaderControls(history.past.length > 0, canGoForward, back, forward);
  return { route: history.route, open, back, leave, replace, discard, reset };
}

/** Hands Back and Forward to the window's content header while the enclosing section is shown. */
function useHeaderControls(
  canGoBack: boolean,
  canGoForward: boolean,
  back: () => void,
  forward: () => void,
) {
  const register = useContext(SettingsPageHistoryContext);
  const active = useContext(SettingsSectionActiveContext);
  // The latest `forward` runs, since it reads this render's `available`; registering once per
  // change of the flags keeps the header from re-rendering on every section render.
  const latest = useRef({ back, forward });
  useLayoutEffect(() => {
    latest.current = { back, forward };
  });
  useLayoutEffect(() => {
    if (!active || !register) return;
    const controls: SettingsPageControls = {
      canGoBack,
      canGoForward,
      back: () => latest.current.back(),
      forward: () => latest.current.forward(),
    };
    return register(controls);
  }, [register, active, canGoBack, canGoForward]);
}
