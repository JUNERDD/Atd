import {
  File as FileIcon,
  FileBraces,
  FileCode,
  FileImage,
  FileText,
  Folder,
  type LucideIcon,
} from 'lucide-react';

/** A listed path split for display: the name in front, the folder it sits in after it. */
export interface PathParts {
  name: string;
  /** The parent folder with its trailing `/`; empty for a bare name. */
  dir: string;
  /** Pi marks directories with a trailing `/`. */
  isDir: boolean;
}

export function pathParts(path: string): PathParts {
  const isDir = path.endsWith('/');
  const trimmed = isDir ? path.slice(0, -1) : path;
  const cut = trimmed.lastIndexOf('/');
  return { name: trimmed.slice(cut + 1) || trimmed, dir: trimmed.slice(0, cut + 1), isDir };
}

const CODE = new Set([
  'c',
  'cc',
  'cjs',
  'cpp',
  'cs',
  'css',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'jsx',
  'kt',
  'm',
  'mjs',
  'mts',
  'php',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'swift',
  'ts',
  'tsx',
  'vue',
  'zsh',
]);
const DATA = new Set(['json', 'jsonc', 'json5', 'toml', 'yaml', 'yml', 'xml', 'plist', 'lock']);
const TEXT = new Set(['md', 'mdx', 'txt', 'rst', 'log', 'csv']);
const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'icns', 'heic', 'avif']);

/**
 * The glyph for a listed entry: a folder, or one of four file families by extension (code, data,
 * prose, image) with a plain file for the rest. Families stay few on purpose; the name carries
 * the exact type.
 */
export function pathGlyph({ name, isDir }: PathParts): LucideIcon {
  if (isDir) return Folder;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (CODE.has(extension)) return FileCode;
  if (DATA.has(extension)) return FileBraces;
  if (TEXT.has(extension)) return FileText;
  if (IMAGE.has(extension)) return FileImage;
  return FileIcon;
}
