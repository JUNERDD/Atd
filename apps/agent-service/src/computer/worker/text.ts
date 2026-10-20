import type { Frame } from 'playwright-core';

/**
 * The roles the worker lists and acts on, and how values reach the host: bounded, with secrets
 * masked. Shared by the snapshot parser, `observe` and the page-changing tools.
 */

/** An ARIA role Playwright's `getByRole` accepts. */
type AriaRole = Parameters<Frame['getByRole']>[0];

/** Roles the worker lists as elements: what a person can press, type into or choose. */
const ELEMENT_ROLE_LIST = [
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'slider',
  'spinbutton',
] as const satisfies readonly AriaRole[];

/** A role the worker lists; every one is also a `getByRole` role. */
export type ElementRole = (typeof ELEMENT_ROLE_LIST)[number];

const ELEMENT_ROLES: ReadonlySet<string> = new Set(ELEMENT_ROLE_LIST);

export function isElementRole(role: string): role is ElementRole {
  return ELEMENT_ROLES.has(role);
}

/** Roles `fill` accepts. */
export const TEXT_ROLES: ReadonlySet<ElementRole> = new Set(['textbox', 'searchbox', 'combobox']);

/** Roles `select` accepts: a native select is a combobox (single) or a listbox (multiple, size). */
export const SELECT_ROLES: ReadonlySet<ElementRole> = new Set(['combobox', 'listbox']);

/** Roles `press` accepts. */
export const PRESS_ROLES: ReadonlySet<ElementRole> = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
]);

const MASK = '[masked]';
const SECRET_NAME = /pass(word|code|phrase)|secret|token|\bpin\b|cvv|cvc|security code|card|iban/i;

/** Whether digits (with spaces or dashes) form a Luhn-valid 12–19 digit number. */
function looksLikeCardNumber(value: string): boolean {
  if (!/^[\d\s-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * Truncates to at most `max` UTF-16 units without splitting a surrogate pair, marking the cut
 * with an ellipsis.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const code = text.charCodeAt(cut - 1);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut)}…`;
}

/**
 * A value as the host may see it: secrets masked (password fields, which Chrome already reports
 * as bullets; fields named like a password, PIN, card or security code; card-like numbers) and
 * the rest truncated to `max`.
 */
export function visibleValue(name: string, value: string, max: number): string {
  if (value === '') return value;
  if (/^[•●*]+$/.test(value) || SECRET_NAME.test(name) || looksLikeCardNumber(value)) return MASK;
  return truncate(value, max);
}
