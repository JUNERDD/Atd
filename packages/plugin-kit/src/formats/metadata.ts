import type { PluginManifest } from '../model/manifest.js';
import { isRecord } from './context.js';

export type ManifestMetadata = Omit<PluginManifest, 'name'>;

/** How lenient a format is about metadata shapes. */
export interface MetadataRules {
  /** npm / Claude accept `repository: { url }`; Agent Plugins only a string. */
  repositoryObject: boolean;
  /** npm / Claude accept `author: "Name <email> (url)"`; Agent Plugins only an object. */
  authorString: boolean;
}

const LIMITS = {
  displayName: 256,
  version: 256,
  description: 4000,
  license: 256,
  homepage: 2048,
  repository: 2048,
} as const;

type LimitedField = keyof typeof LIMITS;

/**
 * Reads the format-neutral metadata fields present in `raw`. Values of the wrong type or over the
 * model's length limits are left out and described in `problems`; the caller decides whether a
 * problem is fatal (Agent Plugins) or a warning (Claude, pi).
 */
export function readMetadata(
  raw: Record<string, unknown>,
  rules: MetadataRules,
): { metadata: ManifestMetadata; problems: string[] } {
  const metadata: ManifestMetadata = {};
  const problems: string[] = [];
  for (const field of Object.keys(LIMITS) as LimitedField[]) {
    let value = raw[field];
    if (value === undefined) continue;
    if (field === 'repository' && rules.repositoryObject && isRecord(value)) value = value.url;
    if (typeof value !== 'string') problems.push(`"${field}" must be a string.`);
    else if (value.length > LIMITS[field]) problems.push(`"${field}" is too long.`);
    else metadata[field] = value;
  }
  if (raw.author !== undefined) {
    const author = readAuthor(raw.author, rules.authorString);
    if (author) metadata.author = author;
    else problems.push('"author" must be an object with string name, email and url.');
  }
  if (raw.keywords !== undefined) {
    const keywords = raw.keywords;
    if (Array.isArray(keywords) && keywords.every((entry) => typeof entry === 'string')) {
      metadata.keywords = (keywords as string[])
        .filter((keyword) => keyword.length <= 128)
        .slice(0, 64);
    } else {
      problems.push('"keywords" must be an array of strings.');
    }
  }
  return { metadata, problems };
}

function readAuthor(value: unknown, allowString: boolean): PluginManifest['author'] | null {
  if (typeof value === 'string' && allowString) return parseAuthorString(value);
  if (!isRecord(value)) return null;
  const author: NonNullable<PluginManifest['author']> = {};
  for (const [key, limit] of [
    ['name', 256],
    ['email', 256],
    ['url', 2048],
  ] as const) {
    const field = value[key];
    if (field === undefined) continue;
    if (typeof field !== 'string' || field.length > limit) return null;
    author[key] = field;
  }
  return author;
}

/** npm's `"Name <email> (url)"` person shorthand. */
export function parseAuthorString(value: string): PluginManifest['author'] | null {
  const match = /^\s*([^<(]*?)\s*(?:<([^>]*)>)?\s*(?:\(([^)]*)\))?\s*$/.exec(value);
  if (!match) return null;
  const author: NonNullable<PluginManifest['author']> = {};
  if (match[1]) author.name = match[1].slice(0, 256);
  if (match[2]) author.email = match[2].trim().slice(0, 256);
  if (match[3]) author.url = match[3].trim().slice(0, 2048);
  return author;
}
