/**
 * Schema pieces every part of the native bridge contract shares (`calls.ts`, `file-calls.ts`,
 * `contract.ts`). Loaded by the export script with Node's type stripping, so it imports nothing but
 * TypeBox and uses only erasable TypeScript syntax.
 */
import { Type } from 'typebox';

/** A call or post without params, or a result without a value. */
export const Empty = Type.Object({}, { additionalProperties: false });
export const Text = (maxLength: number) => Type.String({ maxLength });

/** Longest text `share.text`, `speech.speak` and a text `files.save` take, as `clipboard.write`. */
export const MAX_NATIVE_TEXT_LENGTH = 1000000;
