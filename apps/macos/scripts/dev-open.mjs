#!/usr/bin/env node
/**
 * Native development supervisor: serialize incremental builds, install successful bundles, and
 * restart only the app this process launched. Vite and the development service keep running.
 * The registered ~/Applications copy is required for WidgetKit (see dev-install.mjs).
 */
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevCache } from './dev-cache.mjs';
import { installDevCopy } from './dev-install.mjs';
import { startDevApp } from './dev-launch.mjs';
import { lockNativeDev, runningAppPid, startChild } from './dev-process.mjs';
import { waitForServices } from './dev-ready.mjs';
import { watchNativeInputs } from './dev-watch.mjs';

const BUNDLE_ID = 'com.junerdd.ai.dev';
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const builtAppPath = path.join(packageRoot, 'DerivedData/Build/Products/Debug/Atd.app');
const appPath = path.join(homedir(), 'Applications', 'Atd Dev.app');
const rendererOrigin = new URL(
  process.env.AI_RENDERER_DEV_ORIGIN?.trim() || 'http://127.0.0.1:5173',
);
if (
  rendererOrigin.protocol !== 'http:' ||
  !['127.0.0.1', '[::1]', 'localhost'].includes(rendererOrigin.hostname)
) {
  throw new Error('AI_RENDERER_DEV_ORIGIN must be a loopback HTTP origin.');
}
const dataDir =
  process.env.AI_AGENT_DATA_DIR?.trim() ||
  path.join(homedir(), 'Library', 'Application Support', 'AgentService Dev');
const lifetime = new AbortController();
let app;
let build;
let closeWatch;
let unlock;
let cache;
let timer;
let busy = false;
let pending = true;
let codegenDirty = true;
let codegenRevision = 0;
let writingBridge = false;
let observedOutputs;
let nativeDirty = true;
// A successful build may wait while edits arriving during it are checked or built.
let uninstalledBuild = false;
let builtInputs;
let needsLaunch = true;
let quitting = false;

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(signal, () => {
    void quit();
  });
if (process.platform !== 'darwin') {
  idle(`The native app is macOS-only; skipped on ${process.platform}.`);
} else {
  try {
    unlock = lockNativeDev();
    cache = await createDevCache({
      packageRoot,
      builtApp: builtAppPath,
      installedApp: appPath,
      signal: lifetime.signal,
      log,
    });
    closeWatch = watchNativeInputs(packageRoot, schedule, (error) => {
      log(`Native file watcher failed: ${error.message}. Restart pnpm dev.`);
      void quit(1);
    });
    await rebuild();
  } catch (error) {
    log(error.message);
    unlock?.();
    unlock = undefined;
    idle('Native development was not started; the service and renderer keep running.');
  }
}

function schedule(reason) {
  if (quitting) return;
  if (reason === 'generated') {
    codegenRevision += 1;
    // Failed generators may leave partial output. Its delayed events must not retry the same
    // failure forever; an external content change still differs from this observed fingerprint.
    if (writingBridge || cache.codegen.outputFingerprint() === observedOutputs) return;
  }
  pending = true;
  codegenDirty ||= reason === 'generated';
  if (reason === 'codegen' || reason === 'both') {
    codegenDirty = true;
    codegenRevision += 1;
  }
  nativeDirty ||= reason === 'native' || reason === 'both';
  clearTimeout(timer);
  timer = setTimeout(() => {
    void rebuild();
  }, 250);
}

async function rebuild() {
  if (busy || quitting || !pending) return;
  busy = true;
  pending = false;
  const started = performance.now();
  try {
    if (foreignAppRunning()) {
      log('A Debug app from another session is running; leaving it and its bundle unchanged.');
      return;
    }
    if (codegenDirty) {
      codegenDirty = false;
      const generated = await generateBridge();
      nativeDirty ||= generated.changed;
      if (generated.retry) {
        codegenDirty = true;
        pending = true;
        return;
      }
      if (!generated.ok) {
        codegenDirty = true;
        log('Bridge generation failed; the current app stays open. Watching for the next edit.');
        return;
      }
    }
    if (nativeDirty) {
      nativeDirty = false;
      const inputs = cache.inputs();
      const reusable = cache.lookup(inputs);
      if (reusable.built) {
        uninstalledBuild = !reusable.installed;
        needsLaunch ||= !app?.running || uninstalledBuild;
        log(
          reusable.installed
            ? 'Reusing unchanged Debug app; skipped Xcode build and installation.'
            : 'Reusing unchanged Debug build; refreshing the installed copy.',
        );
      } else {
        cache.invalidate();
        if (!(await command(process.execPath, ['scripts/build.mjs', '--configuration', 'Debug']))) {
          nativeDirty = true;
          uninstalledBuild = false;
          if (!quitting)
            log('Native build failed; the current app stays open. Watching for the next edit.');
          return;
        }
        // A build can have read an intermediate version even if a file was later restored.
        // Never certify it when any edit arrived while Xcode was running.
        if (pending || cache.inputs() !== inputs) {
          nativeDirty = true;
          pending = true;
          uninstalledBuild = false;
          log('Native inputs changed during the build; rebuilding the latest version.');
          return;
        }
        cache.recordBuild(inputs);
        uninstalledBuild = true;
        needsLaunch = true;
        log(`Native build ready in ${((performance.now() - started) / 1000).toFixed(1)}s.`);
      }
      builtInputs = inputs;
    }
    if (!uninstalledBuild && !needsLaunch) {
      if (!quitting) log('Native bridge unchanged; no native rebuild needed.');
      return;
    }
    if (quitting || pending) return; // A newer edit must build before replacing the running app.
    if (foreignAppRunning()) {
      log('Another Debug app started during the build; leaving it unchanged.');
      return;
    }
    log('Waiting for the renderer and authenticated development service…');
    if (!(await waitForServices({ rendererOrigin, dataDir, signal: lifetime.signal }))) return;
    if (quitting || pending) return;
    if (cache.inputs() !== builtInputs) return schedule('native');
    if (!uninstalledBuild) {
      // Readiness can take a while; another build or installation may have changed the bundles.
      const reusable = cache.lookup(builtInputs);
      if (!reusable.built) return schedule('native');
      uninstalledBuild = !reusable.installed;
    }
    await app?.stop();
    app = undefined;
    if (quitting || pending || foreignAppRunning()) return;
    if (uninstalledBuild) {
      const result = await installDevCopy({
        builtApp: builtAppPath,
        installedApp: appPath,
        bundleId: BUNDLE_ID,
        signal: lifetime.signal,
      });
      if (!result.installed) {
        if (!quitting) log(`Debug app installation failed: ${result.problem}`);
        return;
      }
      if (!result.widgetMetadata)
        log('Warning: the widget build is missing its App Intents metadata.');
      // WidgetKit indexing is independent of opening the app. Report it without delaying launch.
      void result.indexed.then((indexed) => {
        if (quitting) return;
        if (indexed === false)
          log('Warning: macOS did not index the widget App Intents within 10s.');
        else if (indexed === null) log("Could not confirm widget indexing from linkd's log.");
      });
      if (quitting || pending) return;
      if (cache.inputs() !== builtInputs) return schedule('native');
      cache.recordInstall(builtInputs);
    }
    if (quitting || foreignAppRunning()) return;
    app = startDevApp({
      appPath,
      bundleId: BUNDLE_ID,
      environment: {
        AI_AGENT_DATA_DIR: dataDir,
        AI_RENDERER_DEV_ORIGIN: rendererOrigin.origin,
        ...(process.env.AI_COMPUTER_HOST_DIR?.trim()
          ? { AI_COMPUTER_HOST_DIR: process.env.AI_COMPUTER_HOST_DIR.trim() }
          : {}),
      },
    });
    const launchedApp = app;
    void app.done.then((ok) => {
      if (!quitting && app === launchedApp) {
        log(
          ok
            ? 'Debug app exited; watching for native edits.'
            : `Debug launch ended: ${app.problem ?? 'launch failed'}`,
        );
      }
    });
    if (!(await app.started)) {
      if (!quitting)
        log(`${app.problem ?? 'The Debug app launch was cancelled.'} Watching for the next edit.`);
      return;
    }
    uninstalledBuild = false;
    needsLaunch = false;
    if (!quitting) log(`Opened Debug app (pid ${app.pid}); native edits rebuild and restart it.`);
  } catch (error) {
    if (!quitting) log(`Native update failed: ${error.message}. Watching for the next edit.`);
  } finally {
    busy = false;
    if (pending && !quitting) schedule();
  }
}

function foreignAppRunning() {
  const pid = runningAppPid(BUNDLE_ID);
  return pid !== null && !(app?.running && pid === app.pid);
}

async function generateBridge() {
  const before = cache.codegen.snapshot();
  observedOutputs = before.outputs;
  if (cache.codegen.matches(before)) {
    log('Reusing verified bridge schemas and Swift types; skipped generation checks.');
    return { ok: true, changed: false };
  }
  cache.codegen.invalidate();
  const revision = codegenRevision;
  const desktopScript = '../desktop/scripts/export-bridge-schema.mjs';
  let changed = false;
  let wrote = false;
  for (const script of [desktopScript, 'scripts/generate-bridge-types.mjs']) {
    // Avoid rewriting unchanged generated Swift: timestamps otherwise invalidate incremental builds.
    if (await command(process.execPath, [script, '--check'], true)) continue;
    if (script === 'scripts/generate-bridge-types.mjs') changed = true;
    if (quitting) return { ok: false, changed };
    writingBridge = true;
    let ok;
    try {
      ok = await command(process.execPath, [script]);
    } finally {
      observedOutputs = cache.codegen.outputFingerprint();
      writingBridge = false;
    }
    if (!ok) return { ok: false, changed };
    wrote = true;
  }
  const after = cache.codegen.snapshot();
  // Includes output events: our own writes cause one stable recheck; external edits cannot
  // certify an intermediate graph. Never start a native build until that recheck settles.
  if (
    wrote ||
    revision !== codegenRevision ||
    before.stamp !== after.stamp ||
    before.inputs !== after.inputs ||
    before.outputs !== after.outputs
  )
    return { ok: true, changed, retry: true };
  cache.codegen.record(after);
  return { ok: true, changed };
}

async function command(executable, args, quiet = false) {
  if (quitting) return false;
  // A previous cleanup failure must not lose ownership of still-running compiler descendants.
  if (build) await build.stop();
  build = startChild(executable, args, { cwd: packageRoot, ...(quiet ? { stdio: 'ignore' } : {}) });
  const ok = await build.done;
  build = undefined;
  return ok && !quitting;
}

async function quit(code = 0) {
  if (quitting) return;
  quitting = true;
  lifetime.abort();
  clearTimeout(timer);
  closeWatch?.();
  try {
    await Promise.all([build?.stop(), app?.stop()]);
  } catch (error) {
    idle(`Native cleanup failed; retaining the supervisor lock: ${error.message}`);
    return;
  }
  unlock?.();
  process.exit(code);
}

function idle(message) {
  log(message);
  setInterval(() => {}, 1 << 30);
}

function log(message) {
  console.log(`[macos] ${message}`);
}
