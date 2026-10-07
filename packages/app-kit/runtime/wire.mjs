// @ts-check
/**
 * Binary values inside api inputs and results. JSON carries the whole path (the page's fetch body,
 * the service's api route, node IPC), and WebKit delivers only string and ArrayBuffer bodies from
 * a custom-scheme page intact (T1: Blob, File, FormData and streamed bodies arrive empty), so bytes
 * travel as `{"$atd:bytes": "<base64>"}` objects that the browser SDK and the backend runtime turn
 * back into `Uint8Array`s. The service passes them through untouched. Shared by both sides, so it
 * uses only APIs that exist in WebKit and Node (`btoa`/`atob`).
 */

export const BYTES_TAG = '$atd:bytes';

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** @param {string} base64 */
export function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {unknown} value @returns {Uint8Array | null} */
function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/**
 * A JSON-safe copy of `value` with every byte array replaced by its tagged form.
 * @param {unknown} value
 * @returns {unknown}
 */
export function toWire(value) {
  const bytes = asBytes(value);
  if (bytes) return { [BYTES_TAG]: bytesToBase64(bytes) };
  if (Array.isArray(value)) return value.map(toWire);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = toWire(entry);
    return out;
  }
  return value;
}

/** @param {unknown} value @returns {value is Record<string, string>} */
function isTagged(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 1 && keys[0] === BYTES_TAG && typeof Reflect.get(value, BYTES_TAG) === 'string'
  );
}

/**
 * `value` with every tagged byte object turned back into a `Uint8Array`.
 * @param {unknown} value
 * @returns {unknown}
 */
export function fromWire(value) {
  if (isTagged(value)) return base64ToBytes(/** @type {string} */ (value[BYTES_TAG]));
  if (Array.isArray(value)) return value.map(fromWire);
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = fromWire(entry);
    return out;
  }
  return value;
}
