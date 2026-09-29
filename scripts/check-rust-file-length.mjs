#!/usr/bin/env node
/**
 * Enforces the repository's 350-line file limit (AGENTS.md → Code Conventions) on Rust sources,
 * which neither rustfmt nor Clippy can check. Lines count the way Oxlint's `max-lines` and
 * SwiftLint's `file_length` do: blank lines and comments included, a final newline not.
 * Covers every tracked or new, non-ignored `.rs` file, so `target/` never counts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX_LINES = 350;

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.rs'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const oversized = files.flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return lines > MAX_LINES ? [`${file}: ${lines} lines`] : [];
});

if (oversized.length > 0) {
  console.error(`Rust files over the ${MAX_LINES}-line limit:\n${oversized.join('\n')}`);
  process.exit(1);
}
console.log(`${files.length} Rust files are within ${MAX_LINES} lines.`);
