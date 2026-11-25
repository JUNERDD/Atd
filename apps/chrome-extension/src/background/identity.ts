import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { InstallationIdSchema } from '../channel/payloads.ts';
import type { ExtensionFrameBody } from '../channel/protocol.ts';
import { FLAVOR } from '../flavor.ts';
import { STORAGE_KEYS } from '../messages/ports.ts';

/**
 * What this extension tells Atd it is in `hello`: a stable installation id (created once, kept in
 * `chrome.storage.local`), its version and flavor, the browser's name and version, and whether
 * file URLs are allowed (uploads need it). The profile is labelled with the browser's brand name
 * only: the extension requests no `identity` permission, so it never knows the profile's email.
 */

const InstallationSchema = Type.Object({ installationId: InstallationIdSchema });
const BrandsSchema = Type.Array(Type.Object({ brand: Type.String(), version: Type.String() }));
const UserAgentDataSchema = Type.Object({ brands: BrandsSchema });
const HighEntropySchema = Type.Object({ fullVersionList: BrandsSchema });

type Brand = { brand: string; version: string };

/** Chrome's GREASE brand entries, such as "Not)A;Brand" or "Not.A/Brand". */
const GREASE_BRAND = /not.?a.?brand/i;
const FALLBACK_LABEL = 'Chrome';
/** Protocol bounds of `hello` (`HelloFrameSchema`). */
const MAX_LABEL = 200;
const MAX_VERSION = 64;

let installation: Promise<string> | undefined;
let version: Promise<string> | undefined;

/**
 * This installation's id, created on first use; one promise, so concurrent callers agree. Boot
 * awaits it before the pairing is restored: a new id also forgets the stored pairing.
 */
export function installationId(): Promise<string> {
  installation ??= loadInstallationId();
  return installation;
}

/**
 * The stored id when it is one `hello` may carry (`InstallationIdSchema`). A missing or invalid
 * one is replaced by a new id, and the pairing secret stored with the old one is removed: Atd
 * paired that secret to an installation id this extension no longer sends.
 */
async function loadInstallationId(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.installation);
  const value: unknown = stored[STORAGE_KEYS.installation];
  if (Value.Check(InstallationSchema, value)) return value.installationId;
  if (value !== undefined) console.warn('[atd] replaced an invalid installation id');
  const created = { installationId: crypto.randomUUID() };
  await chrome.storage.local.remove(STORAGE_KEYS.pairing);
  await chrome.storage.local.set({ [STORAGE_KEYS.installation]: created });
  return created.installationId;
}

/** The browser's brand name ("Google Chrome", "Microsoft Edge", …), or "Chrome". */
export function browserLabel(): string {
  return (preferredBrand(lowEntropyBrands())?.brand ?? FALLBACK_LABEL).slice(0, MAX_LABEL);
}

/** The browser's full version ("131.0.6778.86"), or the user agent's major version. */
export function browserVersion(): Promise<string> {
  version ??= loadBrowserVersion();
  return version;
}

async function loadBrowserVersion(): Promise<string> {
  const full = preferredBrand(await fullVersionList())?.version;
  const fromAgent = /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1];
  return (full ?? fromAgent ?? '').slice(0, MAX_VERSION);
}

/** The `hello` body for a new port; `secret` once paired. */
export async function helloFrame(secret: string | undefined): Promise<ExtensionFrameBody<'hello'>> {
  const [id, chromeVersion, fileAccess] = await Promise.all([
    installationId(),
    browserVersion(),
    chrome.extension.isAllowedFileSchemeAccess(),
  ]);
  return {
    t: 'hello',
    installationId: id,
    extensionVersion: chrome.runtime.getManifest().version,
    flavor: FLAVOR,
    chromeVersion,
    fileAccess,
    ...(secret === undefined ? {} : { secret }),
    profile: { label: browserLabel() },
  };
}

/** The named brand: the first that is neither GREASE nor the generic "Chromium". */
function preferredBrand(brands: readonly Brand[]): Brand | undefined {
  const named = brands.filter((entry) => !GREASE_BRAND.test(entry.brand));
  return named.find((entry) => entry.brand !== 'Chromium') ?? named[0];
}

/**
 * `navigator.userAgentData` is a Chromium API outside TypeScript's DOM library, so it is read as
 * unknown data and checked like any other runtime boundary.
 */
function userAgentData(): unknown {
  const data: unknown = Reflect.get(navigator, 'userAgentData');
  return data;
}

function lowEntropyBrands(): Brand[] {
  const data = userAgentData();
  return Value.Check(UserAgentDataSchema, data) ? data.brands : [];
}

async function fullVersionList(): Promise<Brand[]> {
  const data = userAgentData();
  if (typeof data !== 'object' || data === null) return [];
  const getHighEntropyValues: unknown = Reflect.get(data, 'getHighEntropyValues');
  if (typeof getHighEntropyValues !== 'function') return [];
  try {
    const values: unknown = await Reflect.apply(getHighEntropyValues, data, [['fullVersionList']]);
    return Value.Check(HighEntropySchema, values) ? values.fullVersionList : [];
  } catch {
    return [];
  }
}
