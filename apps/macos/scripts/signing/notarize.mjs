/** Persist submission IDs so a slow Apple queue can be resumed without duplicate submissions. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notaryArgs, run } from './config.mjs';

async function request(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'xcrun',
      ['notarytool', ...args, ...notaryArgs(), '--output-format', 'json'],
      {
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        if (!output.trim())
          throw new Error(`no JSON returned (exit ${code}); see the Apple error above`);
        const result = JSON.parse(output);
        if (code !== 0 && !result.id) throw new Error(result.message || 'notarytool failed.');
        resolve(result);
      } catch (error) {
        reject(new Error(`notarytool returned no usable result: ${error.message}`));
      }
    });
  });
}

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export async function notarize(file, stapleTarget = file) {
  const receiptFile = `${file}.notary.json`;
  const sha256 = digest(file);
  let receipt = existsSync(receiptFile) ? JSON.parse(readFileSync(receiptFile, 'utf8')) : null;
  if (receipt && receipt.sha256 !== sha256)
    throw new Error(
      `Artifact changed since submission. Keep ${receiptFile} for its submission ID, then move it aside before submitting this new artifact.`,
    );
  if (!receipt) {
    const result = await request(['submit', file]);
    if (!result.id) throw new Error('Apple did not return a submission ID.');
    receipt = { sha256, id: result.id, status: 'In Progress' };
    writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  console.log(`Apple notarization submission: ${receipt.id}`);
  if (receipt.status !== 'Accepted') {
    let result;
    try {
      result = await request([
        'wait',
        receipt.id,
        '--timeout',
        process.env.AI_NOTARY_TIMEOUT || '30m',
      ]);
    } catch (error) {
      throw new Error(
        `${error.message}. Submission ${receipt.id} is preserved in ${receiptFile}; rerun to resume without uploading again.`,
      );
    }
    receipt.status = result.status ?? 'In Progress';
    writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.status !== 'Accepted') {
      if (receipt.status === 'Invalid' || receipt.status === 'Rejected')
        run('xcrun', ['notarytool', 'log', receipt.id, ...notaryArgs(), `${file}.notary-log.json`]);
      throw new Error(
        `Apple status: ${receipt.status}. Submission preserved in ${receiptFile}; rerun this command to resume.`,
      );
    }
  }
  run('xcrun', ['stapler', 'staple', stapleTarget]);
  run('xcrun', ['stapler', 'validate', stapleTarget]);
  receipt.sha256 = digest(file); // Stapling changes a DMG's bytes.
  writeFileSync(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Notarized and stapled ${path.basename(stapleTarget)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, target, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('Usage: notarize.mjs <zip|dmg> [app-to-staple]');
  await notarize(path.resolve(file), target ? path.resolve(target) : path.resolve(file));
}
