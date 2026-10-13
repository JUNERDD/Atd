import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveLanguage, type AppLanguage } from '@atd/agent-contracts';

const run = promisify(execFile);

/**
 * The first language in the user's macOS preference list, the one the renderer reads as
 * `navigator.language`. A process the app or launchd starts has no `LANG`, so Node's own locale
 * says `en-US` whatever the user prefers; reading the preference is the only way to agree with
 * the renderer. Null when it cannot be read.
 */
async function preferredMacLanguage(): Promise<string | null> {
  try {
    const { stdout } = await run('/usr/bin/defaults', ['read', '-g', 'AppleLanguages'], {
      timeout: 2000,
    });
    // A property list array: `(\n    "zh-Hans-CN",\n    en\n)`; an entry is quoted only when needed.
    return /^\s*"?([A-Za-z][\w-]*)"?,?\s*$/m.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The language the clients show while the `language` setting is unset (`null`): the OS
 * language, resolved as the renderer resolves it (`resolveLanguage`).
 */
export async function systemLanguage(): Promise<AppLanguage> {
  const preferred = process.platform === 'darwin' ? await preferredMacLanguage() : null;
  return resolveLanguage(preferred ?? Intl.DateTimeFormat().resolvedOptions().locale);
}

/** The language the clients show: the stored setting, else the OS language. */
export async function effectiveLanguage(stored: AppLanguage | null): Promise<AppLanguage> {
  return stored ?? (await systemLanguage());
}
