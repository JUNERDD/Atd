/**
 * Installs the Debug build where macOS offers its widgets (used by dev-open.mjs): a fresh copy in
 * `~/Applications`, registered with LaunchServices so linkd indexes its App Intents metadata.
 *
 * Why every step is needed (runtime acceptance, root decision v11; widget staging 2026-10-04):
 * - linkd keys App Intents metadata by bundle id. Unregistering any copy (`lsregister -u`)
 *   removes the bundle id's whole index, even while another copy stays registered, and
 *   xcodebuild registers the DerivedData product on every build. So the DerivedData build is
 *   unregistered first, every time, before the copy is registered.
 * - Registering an unchanged copy (`lsregister -f`, with or without `-R`, or after `touch`) does
 *   not index it again; only a bundle with new contents does. So the copy is replaced as a new
 *   bundle (removed, then `ditto`), never updated in place.
 * - The Debug build keeps its widget extension in `Contents/PlugIns/DevStaging`, where macOS does
 *   not look for extensions (project.yml `ATD_WIDGETS_EMBED_SUBPATH`). Were it in
 *   `Contents/PlugIns`, chronod would launch the DerivedData build's extension as soon as
 *   xcodebuild registers it, fail there (a sandboxed extension cannot run under `~/Documents`),
 *   and keep using that path after the build is unregistered: Atd's widgets would leave the
 *   widget gallery until chronod restarts. So only this copy gets the extension in place.
 * - The copy gets a build number of its own (`CFBundleVersion`, the app's and the extension's):
 *   chronod reads an extension's widget list again only when its version changes, so a
 *   reinstall that kept the version would go on showing the previous build's widgets.
 * - Moving the extension and changing the build numbers break the build's signatures, so the
 *   extension and then the app are signed again with the certificate the build used (ad hoc
 *   when it had none), keeping their entitlements and the grants macOS ties to that identity.
 * - The copy is registered as trusted (`-trusted`, as xcodebuild registers its products): its new
 *   signature has never been launched, and LaunchServices would otherwise mark it
 *   launch-disabled and leave its widget extension unregistered, unindexed and out of the
 *   widget gallery until the app's first launch.
 * - Indexing happens asynchronously in linkd and failure is silent (the widget just never
 *   configures), so linkd's log is polled briefly and a missing index is reported.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const INDEX_WAIT_MS = 10_000;
const WIDGET_EXTENSION = 'Contents/PlugIns/AtdWidgets.appex';
/** Where the Debug build puts the extension instead (project.yml `ATD_WIDGETS_EMBED_SUBPATH`). */
const STAGED_WIDGET_EXTENSION = 'Contents/PlugIns/DevStaging/AtdWidgets.appex';
/**
 * The widget extension's App Intents metadata. Without it linkd indexes an empty record for the
 * bundle ("aggregateMetadataIsEmpty") and every widget stays a placeholder; an incremental
 * xcodebuild was seen to skip writing it after the intent's sources moved (v11 acceptance).
 */
const WIDGET_METADATA = 'Contents/Resources/Metadata.appintents/extract.actionsdata';

/**
 * Replaces `installedApp` with `builtApp`, puts its widget extension in place and registers it.
 * Returns `{ installed, indexed, widgetMetadata, problem }`: `problem` says why nothing was
 * installed, `indexed` is null when linkd's log could not be read, and `widgetMetadata` is false
 * when the build lacks the widget extension's App Intents metadata. The caller makes sure no
 * instance of the app is running, since its bundle is replaced.
 */
export async function installDevCopy({ builtApp, installedApp, bundleId }) {
  const widgetMetadata = existsSync(path.join(builtApp, STAGED_WIDGET_EXTENSION, WIDGET_METADATA));
  const since = logTimestamp(new Date(Date.now() - 1000));
  spawnSync(LSREGISTER, ['-u', builtApp], { stdio: 'ignore' });
  // WidgetKit keeps the old copy's extension process alive and keeps serving widgets from it
  // after the bundle is replaced; end it so the next request starts the new extension.
  spawnSync('pkill', ['-f', `${path.join(installedApp, WIDGET_EXTENSION)}/`], { stdio: 'ignore' });
  rmSync(installedApp, { recursive: true, force: true });
  mkdirSync(path.dirname(installedApp), { recursive: true });
  const copy = spawnSync('ditto', [builtApp, installedApp], { stdio: 'inherit' });
  const problem =
    copy.error || copy.status !== 0
      ? `the build could not be copied to ${installedApp}`
      : placeWidgetExtension(installedApp, signingIdentity(builtApp));
  if (problem) {
    // An unsigned or half-moved copy must not be found and registered later.
    rmSync(installedApp, { recursive: true, force: true });
    return { installed: false, indexed: false, widgetMetadata, problem };
  }
  spawnSync(LSREGISTER, ['-f', '-R', '-trusted', installedApp], { stdio: 'ignore' });
  return { installed: true, indexed: await waitForIndex(bundleId, since), widgetMetadata, problem };
}

/**
 * Moves the staged widget extension into `Contents/PlugIns`, gives the app and the extension a
 * new build number, signs the extension and then the app with `identity`, and checks the result.
 * Returns what failed, or null.
 */
function placeWidgetExtension(app, identity) {
  const staged = path.join(app, STAGED_WIDGET_EXTENSION);
  const extension = path.join(app, WIDGET_EXTENSION);
  if (!existsSync(staged)) return `the build has no widget extension in ${STAGED_WIDGET_EXTENSION}`;
  renameSync(staged, extension);
  rmSync(path.dirname(staged), { recursive: true, force: true });
  const build = String(Math.floor(Date.now() / 1000));
  // The extension first: the app's signature seals the extension's.
  for (const bundle of [extension, app]) {
    const info = path.join(bundle, 'Contents/Info.plist');
    const stamp = spawnSync('plutil', ['-replace', 'CFBundleVersion', '-string', build, info], {
      encoding: 'utf8',
    });
    if (stamp.status !== 0) return `the build number of ${bundle} could not be set`;
    const sign = spawnSync(
      'codesign',
      [
        '--force',
        '--sign',
        identity,
        '--timestamp=none',
        '--preserve-metadata=identifier,entitlements,requirements,flags,runtime',
        bundle,
      ],
      { encoding: 'utf8' },
    );
    if (sign.status !== 0) return `${bundle} could not be signed: ${sign.stderr.trim()}`;
  }
  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', app], {
    encoding: 'utf8',
  });
  return verify.status === 0 ? null : `the signed copy does not verify: ${verify.stderr.trim()}`;
}

/**
 * The certificate `app` is signed with, as the SHA-1 hash `codesign --sign` accepts (a name could
 * match an expired twin), or `-` for an ad hoc signature.
 */
function signingIdentity(app) {
  const dir = mkdtempSync(path.join(tmpdir(), 'atd-dev-signature-'));
  try {
    const prefix = path.join(dir, 'certificate');
    spawnSync('codesign', ['-d', `--extract-certificates=${prefix}`, app], { stdio: 'ignore' });
    const leaf = `${prefix}0`;
    if (!existsSync(leaf)) return '-';
    return createHash('sha1').update(readFileSync(leaf)).digest('hex').toUpperCase();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Polls linkd's log for a completed indexing of `bundleId` since `since`. */
async function waitForIndex(bundleId, since) {
  const predicate =
    `process == "linkd" AND eventMessage CONTAINS "${bundleId}" ` +
    `AND eventMessage CONTAINS[c] "indexing" AND eventMessage CONTAINS[c] "completed"`;
  const deadline = Date.now() + INDEX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = spawnSync(
      'log',
      ['show', '--start', since, '--info', '--style', 'compact', '--predicate', predicate],
      { encoding: 'utf8' },
    );
    if (result.error || result.status !== 0) return null;
    if (result.stdout.split('\n').some((line) => line.includes(bundleId))) return true;
  }
  return false;
}

/** `log show --start` takes local time as `YYYY-MM-DD HH:MM:SS`. */
function logTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
