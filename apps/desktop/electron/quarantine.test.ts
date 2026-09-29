import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  QUARANTINE_ATTRIBUTE,
  quarantineArgs,
  quarantineValue,
  writeDownloadedFile,
} from './quarantine';

const now = new Date('2026-09-29T12:00:00Z');

describe('quarantine value', () => {
  it('holds flags, hex Unix seconds, the agent and an empty event id', () => {
    expect(quarantineValue('AI', now)).toBe('0081;6abba840;AI;');
    expect(Number.parseInt('6abba840', 16)).toBe(now.getTime() / 1000);
  });

  it('keeps field separators in the agent name from shifting the fields', () => {
    expect(quarantineValue('A;B\nC', now)).toBe('0081;6abba840;A B C;');
  });

  it('passes the value and path as separate xattr arguments', () => {
    expect(quarantineArgs('/tmp/a b; rm -rf.command', 'AI', now)).toEqual([
      '-w',
      'com.apple.quarantine',
      '0081;6abba840;AI;',
      '/tmp/a b; rm -rf.command',
    ]);
  });
});

describe.runIf(process.platform === 'darwin')('downloaded file on macOS', () => {
  let directory = '';
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('writes the bytes and marks the file quarantined', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ai-quarantine-test-'));
    const filePath = path.join(directory, 'run.command');
    await writeDownloadedFile(filePath, new TextEncoder().encode('echo hi\n'), 'AI Test');
    expect(await readFile(filePath, 'utf8')).toBe('echo hi\n');
    const { stdout } = await promisify(execFile)('/usr/bin/xattr', [
      '-p',
      QUARANTINE_ATTRIBUTE,
      filePath,
    ]);
    expect(stdout.trim()).toMatch(/^0081;[0-9a-f]{8};AI Test;$/);
  });
});
