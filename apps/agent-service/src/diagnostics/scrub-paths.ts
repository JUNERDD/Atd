import { homedir } from 'node:os';

/**
 * Replaces personal user home directory prefixes (`/Users/<name>`, `/home/<name>`,
 * and `os.homedir()`) so fatal stderr messages and diagnostic error details never
 * expose local usernames.
 */
export function scrubPersonalPaths(text: string): string {
  if (!text) return text;
  let result = text;
  const home = homedir();
  if (home && home !== '/' && home.length > 1) {
    result = result.split(home).join('~');
  }
  return result
    .replace(/\/Users\/[A-Za-z0-9._-]+/g, '/Users/<user>')
    .replace(/\/home\/[A-Za-z0-9._-]+/g, '/home/<user>');
}
