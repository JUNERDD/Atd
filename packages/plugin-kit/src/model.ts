/**
 * Data model only: TypeBox schemas, types and name helpers, with no dependency beyond `typebox`.
 * For contract packages and UIs that describe plugins without normalizing or installing them;
 * bundling this entry never pulls in the format parsers.
 */
export * from './model/names.js';
export * from './model/diagnostics.js';
export * from './model/manifest.js';
export * from './model/records.js';
