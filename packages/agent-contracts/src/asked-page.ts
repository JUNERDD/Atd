import { Type, type Static } from 'typebox';

/** Longest page title an ask names, in UTF-16 code units; the shell clips a longer one. */
export const ASKED_PAGE_TITLE_MAX = 4096;
/** Longest page URL an ask names, in UTF-16 code units; the shell clips a longer one. */
export const ASKED_PAGE_URL_MAX = 8192;
/** How many picked elements one ask names, as many as the extension's inspector picks. */
export const ASKED_PAGE_ELEMENTS_MAX = 5;

/**
 * An element the person picked on the page with the ask's inspector. The limits are twice the
 * extension's, which counts Unicode scalars where these count UTF-16 code units, so an element the
 * extension sends always passes whole and its selector is never cut.
 */
export const AskedPageElementSchema = Type.Object(
  {
    /** What it is, for a person: its role or tag and its accessible name, e.g. `button "Sign up"`. */
    label: Type.String({ minLength: 1, maxLength: 600 }),
    /** A CSS selector that matched only this element when it was picked; it is not a locator. */
    selector: Type.String({ minLength: 1, maxLength: 2000 }),
    /** Its visible text, clipped by the extension; empty when it has none. */
    text: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type AskedPageElement = Static<typeof AskedPageElementSchema>;

/**
 * `SubmitTaskRequest.page`: the web page an ask from Atd for Chrome came from, and the elements the
 * person picked on it, in order. The service tells the run about it in hidden
 * `RunSnapshot.instructions`, so `input.text`, which the conversation shows as the person's message
 * and names the task by, stays what they typed. Only the run it is sent with is told.
 */
export const AskedPageSchema = Type.Object(
  {
    /** Empty when the page has no title. */
    title: Type.String({ maxLength: ASKED_PAGE_TITLE_MAX }),
    url: Type.String({ minLength: 1, maxLength: ASKED_PAGE_URL_MAX }),
    elements: Type.Array(AskedPageElementSchema, { maxItems: ASKED_PAGE_ELEMENTS_MAX }),
  },
  { additionalProperties: false },
);
export type AskedPage = Static<typeof AskedPageSchema>;
