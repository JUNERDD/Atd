import { Type } from 'typebox';

/**
 * Service wire-protocol version. Every HTTP response envelope and every event
 * carries it so clients can reject a mismatched service before acting.
 * Freeze candidate: `service-contracts v1` pins this to "1".
 */
export const PROTOCOL_VERSION = '1';

/** Stable service name used in endpoint metadata and logs. */
export const SERVICE_NAME = 'agent-service';

/** Identifier alphabet shared by task, run, request and resource ids. */
export const Identifier = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_-]+$',
});

/**
 * A Pi session entry id. Turn actions address a message by it: editing or regenerating a prompt
 * branches the session from just before its entry, and a fork copies the branch up to a turn.
 */
export const SessionEntryId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_-]+$',
});

/**
 * Client-generated idempotency key for run acceptance. Repeating a submit with
 * the same operationId returns the original run instead of starting a new one.
 */
export const OperationId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[a-zA-Z0-9_-]+$',
});
