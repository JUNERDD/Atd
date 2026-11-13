import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { childElements, parseXml, serializeXml } from '../file-loader/xml.js';
import { atomicWrite } from '../config.js';

/** Each data directory owns one registration; development never replaces the installed app's. */
export function registrationName(dataDir: string): string {
  return `AtdSelection-${createHash('sha256').update(dataDir).digest('hex').slice(0, 12)}`;
}

function publishFile(): string {
  return path.join(
    homedir(),
    'Library/Containers/com.kingsoft.wpsoffice.mac/Data/.kingsoft/wps/jsaddons/publish.xml',
  );
}

async function readOptional(file: string): Promise<string | null> {
  try {
    const bytes = await readFile(file);
    if (bytes.length > 256 * 1024) throw new Error('WPS add-in registration is too large.');
    return bytes.toString('utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Changes only our entry and refuses concurrent edits instead of overwriting WPS's changes. */
export async function registerWpsSelection(dataDir: string, url: string | null): Promise<void> {
  const receipt = path.join(dataDir, 'wps-selection', 'registration.json');
  const recorded = await readOptional(receipt);
  if (url === null && recorded === null) return;
  if (process.platform !== 'darwin') throw new Error('WPS selection integration requires macOS.');
  const name = registrationName(dataDir);
  const previous: unknown = recorded === null ? null : JSON.parse(recorded);
  if (previous !== null && typeof previous !== 'string')
    throw new Error('Invalid WPS registration receipt.');
  const file = publishFile();
  const before = await readOptional(file);
  if (before === null && url === null) {
    await rm(receipt, { force: true });
    return;
  }
  const root = parseXml(before ?? '<jsplugins/>');
  if (root.localName !== 'jsplugins')
    throw new Error('WPS add-in registration has an unexpected format.');
  const owned = childElements(root).filter((node) => node.getAttribute('name') === name);
  if (owned.some((node) => ![previous, url].includes(node.getAttribute('url'))))
    throw new Error('The WPS registration was changed outside Atd.');
  if (
    url &&
    owned.length === 1 &&
    owned[0]?.getAttribute('url') === url &&
    owned[0]?.getAttribute('enable') === 'enable_dev'
  ) {
    if (recorded === null) await atomicWrite(receipt, url, 0o600);
    return;
  }
  if (url === null && owned.length === 0) {
    await rm(receipt, { force: true });
    return;
  }
  // Refuse a missing WPS profile; do not create another application's container.
  if (url) await access(path.resolve(path.dirname(file), '../../..'));
  for (const node of owned) root.removeChild(node);
  if (url) {
    const entry = root.ownerDocument.createElementNS('', 'jspluginonline');
    for (const [key, value] of Object.entries({
      name,
      type: 'et',
      url,
      debug: '',
      enable: 'enable_dev',
      install: 'null',
    }))
      entry.setAttribute(key, value);
    root.appendChild(entry);
  }
  if ((await readOptional(file)) !== before)
    throw new Error('WPS changed its add-in registration. Try again.');
  await mkdir(path.dirname(file), { recursive: true });
  // Record ownership before publication so an interrupted install remains removable.
  if (url) await atomicWrite(receipt, url, 0o600);
  const temporary = `${file}.${name}.tmp`;
  try {
    await writeFile(temporary, serializeXml(root.ownerDocument), { mode: 0o600, flag: 'wx' });
    if ((await readOptional(file)) !== before)
      throw new Error('WPS changed its add-in registration. Try again.');
    await rename(temporary, file);
    if (url === null) await rm(receipt, { force: true });
  } finally {
    await rm(temporary, { force: true });
  }
}
