#!/usr/bin/env node
/**
 * Builds the keyboard's pinyin lexicon from the vendored rime-pinyin-simp dictionary
 * (Lexicon/README.md has its provenance and the format):
 *
 *   node scripts/lexicon.mjs           writes Sources/AtdPinyin/Resources/pinyin.lexicon
 *   node scripts/lexicon.mjs --check   fails unless the checked-in lexicon is what the source
 *                                      builds and the source matches the README's checksum
 *
 * The output is deterministic: the same source always builds the same bytes.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { packageRoot } from './xcode.mjs';

const sourcePath = path.join(packageRoot, 'Lexicon', 'pinyin_simp.dict.yaml');
const readmePath = path.join(packageRoot, 'Lexicon', 'README.md');
const outputPath = path.join(packageRoot, 'Sources', 'AtdPinyin', 'Resources', 'pinyin.lexicon');

const MAGIC = 'ATDPY001';
const HEADER_SIZE = 48;
const SYLLABLE_SIZE = 8;
const ENTRY_SIZE = 16;
const MAX_SYLLABLES = 4;
/** Scores are natural logs of the weights, in units of 1/2000. */
const SCALE = 2000;

function fail(message) {
  process.stderr.write(`lexicon: ${message}\n`);
  process.exit(1);
}

/** Reads `word<TAB>pin yin<TAB>weight` lines after the YAML header's `...`. */
function readEntries(source) {
  const lines = source.split('\n');
  const start = lines.indexOf('...');
  if (start < 0) fail('no "..." line ends the dictionary header');
  const byKey = new Map();
  for (const [index, line] of lines.slice(start + 1).entries()) {
    if (line === '' || line.startsWith('#')) continue;
    const [text, reading, weight = '0'] = line.split('\t');
    const syllables = reading?.split(' ') ?? [];
    const lineNumber = start + index + 2;
    if (!text || syllables.length === 0 || syllables.length > MAX_SYLLABLES)
      fail(`line ${lineNumber}: expected a word with 1-${MAX_SYLLABLES} syllables`);
    if (!syllables.every((syllable) => /^[a-z]{1,7}$/.test(syllable)))
      fail(`line ${lineNumber}: unexpected syllable in "${reading}"`);
    if (!/^\d+$/.test(weight)) fail(`line ${lineNumber}: unexpected weight "${weight}"`);
    if (Buffer.byteLength(text) > 255) fail(`line ${lineNumber}: word too long`);
    // A word listed twice with one reading keeps its larger weight.
    const key = `${text}\t${reading}`;
    const count = Number(weight);
    if ((byKey.get(key)?.count ?? -1) < count) byKey.set(key, { text, syllables, count });
  }
  return [...byKey.values()];
}

function build(source) {
  const entries = readEntries(source);
  const syllables = [...new Set(entries.flatMap((entry) => entry.syllables))].sort();
  // Ids start at 1 so that 0 pads shorter words, which then sort before longer ones.
  const ids = new Map(syllables.map((syllable, index) => [syllable, index + 1]));
  const total = entries.reduce((sum, entry) => sum + entry.count + 1, 0);
  for (const entry of entries) {
    entry.ids = [0, 1, 2, 3].map((index) => ids.get(entry.syllables[index]) ?? 0);
    entry.score = Math.min(Math.round(Math.log(entry.count + 1) * SCALE), 0xffff);
    entry.bytes = Buffer.from(entry.text, 'utf8');
  }
  entries.sort((a, b) => {
    for (let index = 0; index < MAX_SYLLABLES; index++)
      if (a.ids[index] !== b.ids[index]) return a.ids[index] - b.ids[index];
    return b.score - a.score || Buffer.compare(a.bytes, b.bytes);
  });
  const byText = entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        Buffer.compare(a.entry.bytes, b.entry.bytes) ||
        b.entry.score - a.entry.score ||
        a.index - b.index,
    );

  const syllableOffset = HEADER_SIZE;
  const entryOffset = syllableOffset + syllables.length * SYLLABLE_SIZE;
  const textIndexOffset = entryOffset + entries.length * ENTRY_SIZE;
  const textOffset = textIndexOffset + entries.length * 4;
  const textLength = entries.reduce((sum, entry) => sum + entry.bytes.length, 0);
  const output = Buffer.alloc(textOffset + textLength);

  output.write(MAGIC, 0, 'ascii');
  const header = [
    syllables.length,
    entries.length,
    syllableOffset,
    entryOffset,
    textIndexOffset,
    textOffset,
    textLength,
    Math.round(Math.log(total) * SCALE),
  ];
  header.forEach((value, index) => output.writeUInt32LE(value, 8 + index * 4));
  syllables.forEach((syllable, index) => {
    const offset = syllableOffset + index * SYLLABLE_SIZE;
    output.writeUInt8(syllable.length, offset);
    output.write(syllable, offset + 1, 'ascii');
  });
  let text = textOffset;
  entries.forEach((entry, index) => {
    const offset = entryOffset + index * ENTRY_SIZE;
    entry.ids.forEach((id, slot) => output.writeUInt16LE(id, offset + slot * 2));
    output.writeUInt8(entry.syllables.length, offset + 8);
    output.writeUInt8(entry.bytes.length, offset + 9);
    output.writeUInt16LE(entry.score, offset + 10);
    output.writeUInt32LE(text - textOffset, offset + 12);
    entry.bytes.copy(output, text);
    text += entry.bytes.length;
  });
  byText.forEach(({ index }, position) =>
    output.writeUInt32LE(index, textIndexOffset + position * 4),
  );
  return { output, entries: entries.length, syllables: syllables.length };
}

const source = readFileSync(sourcePath);
const { output, entries, syllables } = build(source.toString('utf8'));
const summary = `${entries} words, ${syllables} syllables, ${output.length} bytes`;

if (process.argv.includes('--check')) {
  const digest = createHash('sha256').update(source).digest('hex');
  const recorded = readFileSync(readmePath, 'utf8').match(/SHA-256: `([0-9a-f]{64})`/)?.[1];
  if (recorded !== digest)
    fail(`Lexicon/pinyin_simp.dict.yaml (${digest}) does not match the README's checksum`);
  if (!existsSync(outputPath) || !readFileSync(outputPath).equals(output))
    fail('pinyin.lexicon is out of date; run `node scripts/lexicon.mjs`');
  process.stdout.write(`lexicon: up to date (${summary})\n`);
} else {
  writeFileSync(outputPath, output);
  process.stdout.write(`lexicon: wrote ${path.relative(packageRoot, outputPath)} (${summary})\n`);
}
