// Exports the native bridge contracts as JSON Schema, the input the Swift Codable types are
// generated from: the renderer's (src/native-bridge/contract.ts and its calls.ts) and the user
// apps' (src/native-bridge/user-app-contract.ts), each to its own file, since the shell keeps
// their types and dispatchers apart. `--check` compares the checked-in files instead of writing
// them and fails when a contract changed without a new export.
//
//   node scripts/export-bridge-schema.mjs          write src/native-bridge/*.schema.json
//   node scripts/export-bridge-schema.mjs --check  exit 1 when one of them is stale
//
// Node loads the TypeScript contract through its built-in type stripping.
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as calls from '../src/native-bridge/calls.ts';
import * as contract from '../src/native-bridge/contract.ts';
import * as userApp from '../src/native-bridge/user-app-contract.ts';

const schemaFile = (name) =>
  fileURLToPath(new URL(`../src/native-bridge/${name}`, import.meta.url));

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
      screenshotShortcutId: calls.SCREENSHOT_SHORTCUT_ID,
      maxCaptureLength: calls.MAX_CAPTURE_LENGTH,
      calls: Object.keys(calls.NativeCalls),
      posts: Object.keys(contract.NativePosts),
      events: Object.keys(contract.NativeEvents),
    },
    anyOf: [{ $ref: '#/$defs/JsMessage' }, { $ref: '#/$defs/SwiftMessage' }],
    $defs: definitions,
  };
}

/**
 * The user app bridge (`atdApp`). Definitions carry a `UserApp` prefix: the generated Swift types
 * share a module with the renderer's, whose calls have the same names (`clipboard.write`).
 */
function userAppDocument() {
  const definitions = {
    UserAppMessage: json(userApp.UserAppMessageSchema),
    UserAppFile: json(userApp.UserAppFileSchema),
  };
  for (const [method, { params, result }] of Object.entries(userApp.UserAppCalls)) {
    definitions[`UserApp${pascal(method)}Params`] = json(params);
    definitions[`UserApp${pascal(method)}Result`] = json(result);
  }
  for (const [method, params] of Object.entries(userApp.UserAppPosts))
    definitions[`UserApp${pascal(method)}Post`] = json(params);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'ai-app://renderer/user-app-bridge.schema.json',
    title: 'User app bridge',
    description:
      'Generated from apps/desktop/src/native-bridge/user-app-contract.ts by scripts/export-bridge-schema.mjs; do not edit.',
    'x-bridge': {
      messageHandler: userApp.USER_APP_MESSAGE_HANDLER,
      scheme: userApp.USER_APP_SCHEME,
      appIdPattern: userApp.USER_APP_ID_PATTERN,
      maxFileBytes: userApp.MAX_USER_APP_FILE_BYTES,
      calls: Object.keys(userApp.UserAppCalls),
      posts: Object.keys(userApp.UserAppPosts),
    },
    $ref: '#/$defs/UserAppMessage',
    $defs: definitions,
  };
}

const documents = [
  [schemaFile('native-bridge.schema.json'), schemaDocument()],
  [schemaFile('user-app-bridge.schema.json'), userAppDocument()],
];
if (process.argv.includes('--check')) {
  for (const [output, document] of documents) {
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
  }
} else {
  for (const [output, document] of documents)
    writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  // The repository formatter owns the file layout; `format:check` covers it like any other file.
  execFileSync('pnpm', ['exec', 'oxfmt', ...documents.map(([output]) => output)], {
    stdio: 'inherit',
  });
}
