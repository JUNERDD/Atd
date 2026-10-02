// Exports the native bridge contract (src/native-bridge/contract.ts and its calls.ts) as JSON
// Schema, the input the Swift Codable types are generated from. `--check` compares the checked-in
// file instead of writing it and fails when the contract changed without a new export.
//
//   node scripts/export-bridge-schema.mjs          write src/native-bridge/native-bridge.schema.json
//   node scripts/export-bridge-schema.mjs --check  exit 1 when that file is stale
//
// Node loads the TypeScript contract through its built-in type stripping.
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as calls from '../src/native-bridge/calls.ts';
import * as contract from '../src/native-bridge/contract.ts';

const output = fileURLToPath(
  new URL('../src/native-bridge/native-bridge.schema.json', import.meta.url),
);

/** `window.setPinned` → `WindowSetPinned`. */
const pascal = (name) =>
  name
    .split(/[.\s_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/** A plain JSON copy: drops TypeBox's non-enumerable bookkeeping and fixes key order. */
const json = (schema) => JSON.parse(JSON.stringify(schema));

function schemaDocument() {
  const definitions = {
    JsMessage: json(contract.JsMessageSchema),
    SwiftMessage: json(contract.SwiftMessageSchema),
    FileRef: json(calls.NativeFileRefSchema),
    ShortcutRegistration: json(calls.ShortcutRegistrationSchema),
    ShortcutResult: json(calls.ShortcutResultSchema),
    SocketFrame: json(contract.SocketFrameSchema),
  };
  for (const [method, { params, result }] of Object.entries(calls.NativeCalls)) {
    definitions[`${pascal(method)}Params`] = json(params);
    definitions[`${pascal(method)}Result`] = json(result);
  }
  for (const [method, params] of Object.entries(contract.NativePosts))
    definitions[`${pascal(method)}Post`] = json(params);
  for (const [event, payload] of Object.entries(contract.NativeEvents))
    definitions[`${pascal(event)}Event`] = json(payload);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'ai-app://renderer/native-bridge.schema.json',
    title: 'Native bridge',
    description:
      'Generated from apps/desktop/src/native-bridge/contract.ts by scripts/export-bridge-schema.mjs; do not edit.',
    'x-bridge': {
      messageHandler: contract.MESSAGE_HANDLER,
      deliverScript: contract.DELIVER_SCRIPT,
      deliverArgument: contract.DELIVER_ARGUMENT,
      panelShortcutId: calls.PANEL_SHORTCUT_ID,
      maxCaptureLength: calls.MAX_CAPTURE_LENGTH,
      calls: Object.keys(calls.NativeCalls),
      posts: Object.keys(contract.NativePosts),
      events: Object.keys(contract.NativeEvents),
    },
    anyOf: [{ $ref: '#/$defs/JsMessage' }, { $ref: '#/$defs/SwiftMessage' }],
    $defs: definitions,
  };
}

const document = schemaDocument();
if (process.argv.includes('--check')) {
  let current = null;
  try {
    current = JSON.parse(readFileSync(output, 'utf8'));
  } catch {
    // A missing or unreadable file is stale as well.
  }
  if (!isDeepStrictEqual(current, document)) {
    console.error(
      `${output} is out of date with the bridge contract. Run: pnpm --filter @atd/desktop bridge-schema`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  // The repository formatter owns the file layout; `format:check` covers it like any other file.
  execFileSync('pnpm', ['exec', 'oxfmt', output], { stdio: 'inherit' });
}
