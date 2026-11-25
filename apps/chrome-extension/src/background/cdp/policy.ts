/**
 * Which worker CDP methods reach an owned tab (D8). An allowlist, unlike the denylist of
 * Playwright's own extension (packages/extension `cdpPolicy.ts`), which lets profile-wide cookie
 * methods through: in the person's daily Chrome nothing may reach past the tabs handed to a run.
 *
 * The list is what playwright-core 1.65.1's Chromium layer sends for the worker's steps on a
 * browser it did not launch (`connectOverCDP` with `noDefaults`): `FrameSession._initialize`,
 * `CRNetworkManager.addSession`, `RawMouseImpl` / `RawKeyboardImpl`, `CRExecutionContext`,
 * `DragManager`, the screenshotter and the screencast, read from its bundled source. Methods it
 * sends only for options the worker never sets stay out: viewport, media, locale, timezone,
 * geolocation, touch and user agent emulation, focus emulation (skipped by `noDefaults`), request
 * interception (`Fetch.*`), cache and offline switches, extra headers, `Security.*` and CSP bypass.
 *
 * Refused outright, whatever the session: browser-wide discovery and contexts
 * (`Target.getTargets`, `Target.setDiscoverTargets`, `Target.createBrowserContext`), every other
 * `Browser.*`, profile data (`Storage.*`, `Network` cookie and cache methods), and debugging or
 * profiling surfaces (`Debugger`, `HeapProfiler`, `Profiler`, `Tracing`). `Target.*` methods on a
 * tab's session and the root's emulated methods are decided in `connection.ts`, which knows the
 * sessions involved.
 */
const FORWARDED: ReadonlySet<string> = new Set([
  // Page lifecycle, frames and the utility world Playwright evaluates in.
  'Page.enable',
  'Page.getFrameTree',
  'Page.setLifecycleEventsEnabled',
  'Page.addScriptToEvaluateOnNewDocument',
  'Page.removeScriptToEvaluateOnNewDocument',
  'Page.createIsolatedWorld',
  // Navigation (goto, reload, back and forward) and answering JavaScript dialogs.
  'Page.navigate',
  'Page.reload',
  'Page.getNavigationHistory',
  'Page.navigateToHistoryEntry',
  'Page.handleJavaScriptDialog',
  // Pixels: screenshots, the preview's screencast, and the file chooser of uploads.
  'Page.captureScreenshot',
  'Page.getLayoutMetrics',
  'Page.startScreencast',
  'Page.stopScreencast',
  'Page.screencastFrameAck',
  'Page.setInterceptFileChooserDialog',
  // Closing an owned tab through its beforeunload handlers (`page.close({runBeforeUnload})`).
  'Page.close',
  // Evaluation: the injected script, locators, aria snapshots and element handles.
  'Runtime.enable',
  'Runtime.runIfWaitingForDebugger',
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.getProperties',
  'Runtime.releaseObject',
  'Runtime.addBinding',
  // Element identity and geometry for actions; file inputs for uploads.
  'DOM.describeNode',
  'DOM.resolveNode',
  'DOM.getBoxModel',
  'DOM.getContentQuads',
  'DOM.scrollIntoViewIfNeeded',
  'DOM.getFrameOwner',
  'DOM.setFileInputFiles',
  // Input, including the drag interception Playwright's mouse uses while a button is held.
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  'Input.dispatchTouchEvent',
  'Input.setInterceptDrags',
  'Input.dispatchDragEvent',
  // A transparent background for `omitBackground` screenshots, restored right after.
  'Emulation.setDefaultBackgroundColorOverride',
  // Request and response events Playwright tracks (no interception, cookies or cache changes).
  'Network.enable',
  // Console messages and crash reports.
  'Log.enable',
  'Inspector.enable',
]);

/** Whether `method` is forwarded as is to an owned tab's session or one of its child sessions. */
export function isForwarded(method: string): boolean {
  return FORWARDED.has(method);
}
