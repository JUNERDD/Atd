import type { Frame, Locator } from 'playwright-core';
import type { SnapshotElement } from './snapshot.js';

/** One listed element with the frame and role/name locator that addresses it. */
export interface Element extends SnapshotElement {
  frame: Frame;
  origin: string;
  /** Index among the frame's elements with the same role (and name, when named). */
  nth: number;
}

/** The main document as one fixed evaluation read it. */
export interface DocumentState {
  url: string;
  title: string;
  navigationGeneration: number;
}

/** A full read of a page: document, elements of allowed frames and the observation version. */
export interface PageRead extends DocumentState {
  observationVersion: number;
  elements: Element[];
}

/** The binding's origins as the host passes them; absent: the main frame's own origin. */
export type Origins = readonly string[] | undefined;

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return 'null';
  }
}

/** The Playwright locator of a listed element: its role and exact name, nth in its frame. */
export function locatorFor(element: Element): Locator {
  const base =
    element.name === ''
      ? element.frame.getByRole(element.role)
      : element.frame.getByRole(element.role, { name: element.name, exact: true });
  return base.nth(element.nth);
}

export function refOf(read: PageRead, element: Element): string {
  return `${read.navigationGeneration}.${read.elements.indexOf(element) + 1}`;
}
