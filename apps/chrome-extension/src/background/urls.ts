/**
 * Which URLs count as web pages. Atd acts only on web pages in the person's Chrome: a site
 * binding covers an http(s) origin, and a run opens or navigates a tab only to an http(s) page or
 * a blank one, never to browser, extension or file pages, or a script URL.
 */

/** The origin and host of an http(s) URL, else undefined. */
export function webOrigin(url: string): { origin: string; host: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  return { origin: parsed.origin, host: parsed.host };
}

/** Whether a run may open or navigate a tab to `url`: an http(s) page or `about:blank`. */
export function isOpenableUrl(url: string): boolean {
  return url === 'about:blank' || webOrigin(url) !== undefined;
}
