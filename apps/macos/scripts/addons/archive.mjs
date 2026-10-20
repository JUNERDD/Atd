/**
 * The add-on archive format: a gzip-compressed ustar archive of regular files only, written so the
 * same files always give the same bytes (and so the same SHA-256 the lock pins). Entries come in
 * the order given (the packer puts `addon.json` first, then the files sorted by path); each has
 * mtime 0, uid and gid 0, empty owner names and mode 0644 or 0755; there are no directory, link
 * or extended-header entries, and the gzip header's mtime is 0. `readArchive` parses the same
 * format back for verify-app and reports what it finds, so any deviation can be named.
 */
import { gunzipSync, gzipSync } from 'node:zlib';

const BLOCK = 512;
const NAME_MAX = 100;
const PREFIX_MAX = 155;
export const FILE_MODE = 0o644;
export const EXECUTABLE_MODE = 0o755;

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

/** Splits a path longer than the name field at a `/` into ustar's prefix and name. */
function splitName(file) {
  if (Buffer.byteLength(file) <= NAME_MAX) return { prefix: '', name: file };
  for (let at = file.indexOf('/'); at !== -1; at = file.indexOf('/', at + 1)) {
    const prefix = file.slice(0, at);
    const name = file.slice(at + 1);
    if (Buffer.byteLength(prefix) <= PREFIX_MAX && Buffer.byteLength(name) <= NAME_MAX)
      return { prefix, name };
  }
  throw new Error(`${file} is too long for a ustar entry.`);
}

function checksum(header) {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1)
    sum += index >= 148 && index < 156 ? 0x20 : header[index];
  return sum;
}

function header(file, size, mode) {
  const block = Buffer.alloc(BLOCK);
  const { prefix, name } = splitName(file);
  block.write(name, 0, NAME_MAX, 'ascii');
  block.write(octal(mode, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(0, 12), 136, 'ascii');
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  block.write(prefix, 345, PREFIX_MAX, 'ascii');
  block.write(`${checksum(block).toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
  return block;
}

/**
 * The archive bytes for `entries` ({ path, data, mode }) in the given order. Compression level 9
 * is fixed: zlib's output depends only on the input and the level.
 */
export function writeArchive(entries) {
  const blocks = [];
  for (const { path, data, mode } of entries) {
    blocks.push(header(path, data.length, mode), data);
    const padding = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(blocks), { level: 9 });
}

function field(block, start, length) {
  const raw = block.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? length : end).toString('ascii');
}

function number(block, start, length) {
  const text = field(block, start, length).trim();
  if (!/^[0-7]*$/.test(text)) throw new Error(`Malformed octal field "${text}".`);
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/**
 * Parses archive bytes into `{ gzipMtime, entries }`, each entry with its path, type flag, mode,
 * uid, gid, mtime, owner names and data. Throws on a corrupt stream, a bad header checksum or a
 * missing end-of-archive marker.
 */
export function readArchive(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b)
    throw new Error('Not a gzip stream.');
  const gzipMtime = bytes.readUInt32LE(4);
  const tar = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  for (;;) {
    if (offset + BLOCK > tar.length) throw new Error('The archive has no end-of-archive marker.');
    const block = tar.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    if (number(block, 148, 8) !== checksum(block))
      throw new Error(`Bad header checksum at byte ${offset}.`);
    const name = field(block, 0, NAME_MAX);
    const prefix = field(block, 345, PREFIX_MAX);
    const size = number(block, 124, 12);
    const start = offset + BLOCK;
    if (start + size > tar.length) throw new Error(`${name} is truncated.`);
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      type: field(block, 156, 1) || '0',
      mode: number(block, 100, 8),
      uid: number(block, 108, 8),
      gid: number(block, 116, 8),
      mtime: number(block, 136, 12),
      owners: field(block, 265, 32) + field(block, 297, 32),
      data: tar.subarray(start, start + size),
    });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  return { gzipMtime, entries };
}
