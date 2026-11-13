/** Persist submission IDs so a slow Apple queue can be resumed without duplicate submissions. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { notaryArgs, run } from './config.mjs';

const submissionId = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const statuses = new Set(['Accepted', 'In Progress', 'Invalid', 'Rejected']);

function jsonObject(output) {
  try {
    const value = JSON.parse(output);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

class NotaryToolError extends Error {
  constructor(operation, code, signal, result, stderr, invalidResult = 'returned invalid JSON') {
    const outcome = signal
      ? `was terminated by ${signal}`
      : code !== 0
        ? `exited with code ${code}`
        : invalidResult;
    const detail = typeof result?.message === 'string' ? result.message : stderr.trim();
    super(`notarytool ${operation} ${outcome}${detail ? `: ${detail}` : ''}`);
    this.exitCode = code;
    this.signal = signal;
    this.result = result;
  }
}

async function request(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      'xcrun',
      ['notarytool', ...args, ...notaryArgs(), '--output-format', 'json'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      const result = jsonObject(output);
      if (code !== 0 || signal || !result) {
        reject(new NotaryToolError(args[0], code, signal, result || jsonObject(stderr), stderr));
        return;
      }
      resolve(result);
    });
  });
}

const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const saveReceipt = (file, receipt) => writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);

function failedUpload(error, sha256) {
  const native = error instanceof NotaryToolError ? error : null;
  return {
    sha256,
    id: submissionId(native?.result?.id) ? native.result.id : null,
    status: null,
    upload: {
      state: 'failed',
      exitCode: native?.exitCode ?? null,
      signal: native?.signal ?? null,
      recordedAt: new Date().toISOString(),
    },
  };
}

function rejectSubmission(file, receipt, receiptFile) {
  let logError;
  try {
    run('xcrun', ['notarytool', 'log', receipt.id, ...notaryArgs(), `${file}.notary-log.json`]);
  } catch (error) {
    logError = error;
  }
  throw new Error(
    `Apple status: ${receipt.status}. Submission preserved in ${receiptFile}.` +
      (logError ? ` Could not download its diagnostic log: ${logError.message}` : ''),
    logError ? { cause: logError } : undefined,
  );
}

export async function notarize(file, stapleTarget = file) {
  const receiptFile = `${file}.notary.json`;
  const sha256 = digest(file);
  const hasReceipt = existsSync(receiptFile);
  let receipt = hasReceipt ? JSON.parse(readFileSync(receiptFile, 'utf8')) : null;
  if (hasReceipt && (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)))
    throw new Error(`Invalid notarization receipt: ${receiptFile}; no new submission was made.`);
  if (receipt && receipt.sha256 !== sha256)
    throw new Error(
      `Artifact changed since submission. Keep ${receiptFile} for its submission ID, then move it aside before submitting this new artifact.`,
    );
  if (receipt?.upload?.state === 'failed')
    throw new Error(
      `The previous upload was not verified. Inspect ${receiptFile} and any recorded submission ID before retrying; no new submission was made.`,
    );
  if (
    receipt?.upload &&
    (receipt.upload.state !== 'complete' ||
      receipt.upload.exitCode !== 0 ||
      receipt.upload.signal !== null)
  )
    throw new Error(`Invalid upload result in ${receiptFile}; no new submission was made.`);
  if (receipt && (!submissionId(receipt.id) || !statuses.has(receipt.status)))
    throw new Error(`Invalid notarization receipt: ${receiptFile}; no new submission was made.`);
  if (!receipt) {
    let result;
    try {
      result = await request(['submit', file]);
      if (!submissionId(result.id))
        throw new NotaryToolError(
          'submit',
          0,
          null,
          result,
          '',
          'returned an invalid submission ID',
        );
    } catch (error) {
      saveReceipt(receiptFile, failedUpload(error, sha256));
      throw new Error(
        `Upload completion could not be verified. Attempt preserved in ${receiptFile}. ${error.message}`,
        { cause: error },
      );
    }
    receipt = {
      sha256,
      id: result.id,
      status: 'In Progress',
      upload: {
        state: 'complete',
        exitCode: 0,
        signal: null,
        recordedAt: new Date().toISOString(),
      },
    };
    saveReceipt(receiptFile, receipt);
    console.log(`Upload completed successfully (notarytool submit exit 0): ${receipt.id}`);
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
      // Terminal rejection is still a failure, but its JSON lets us retain Apple's diagnostic.
      if (
        error instanceof NotaryToolError &&
        error.result?.id === receipt.id &&
        ['Invalid', 'Rejected'].includes(error.result.status)
      ) {
        receipt.status = error.result.status;
        saveReceipt(receiptFile, receipt);
        rejectSubmission(file, receipt, receiptFile);
      }
      const detail =
        error instanceof NotaryToolError && error.exitCode === 124
          ? 'Stopped waiting at the configured timeout; Apple may still be processing the submission'
          : error.message;
      throw new Error(
        `${detail}. Submission ${receipt.id} is preserved in ${receiptFile}; resume without uploading again.`,
        { cause: error },
      );
    }
    if (result.id !== receipt.id || !statuses.has(result.status))
      throw new Error(
        `Invalid notarization wait response; submission preserved in ${receiptFile}.`,
      );
    receipt.status = result.status;
    saveReceipt(receiptFile, receipt);
    if (receipt.status !== 'Accepted') {
      if (receipt.status === 'Invalid' || receipt.status === 'Rejected')
        rejectSubmission(file, receipt, receiptFile);
      throw new Error(
        `Apple status: ${receipt.status}. Submission preserved in ${receiptFile}; rerun this command to resume.`,
      );
    }
  }
  run('xcrun', ['stapler', 'staple', stapleTarget]);
  run('xcrun', ['stapler', 'validate', stapleTarget]);
  receipt.sha256 = digest(file); // Stapling changes a DMG's bytes.
  saveReceipt(receiptFile, receipt);
  console.log(`Notarized and stapled ${path.basename(stapleTarget)}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, target, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw new Error('Usage: notarize.mjs <zip|dmg> [app-to-staple]');
  await notarize(path.resolve(file), target ? path.resolve(target) : path.resolve(file));
}
