import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { isOpenableUrl } from '../urls.ts';
import { CDP_ERROR, CdpError, stringParam, type CdpParams } from './messages.ts';

/**
 * Navigation an owned tab's session forwards only to web pages (D8), as `tab.open` and
 * `Target.createTarget` open only web pages: `Page.navigate` to an http(s) URL or `about:blank`,
 * and `Page.navigateToHistoryEntry` only to an entry whose URL is one. A history entry is known
 * by id alone, so its URL is read from the same session's history first; an entry that cannot be
 * checked is refused.
 */

/** Sends one command to the session the navigation came on. */
export type SessionSend = (method: string, params: CdpParams) => Promise<object>;

const HistorySchema = Type.Object({
  entries: Type.Array(Type.Object({ id: Type.Integer(), url: Type.String() })),
});

/**
 * The navigation command `method`, checked and sent; undefined when `method` is not one. A
 * `Page.navigate` is sent before anything is awaited, so it keeps its place among the commands.
 */
export function navigationCommand(
  method: string,
  params: CdpParams,
  send: SessionSend,
): Promise<object> | undefined {
  switch (method) {
    case 'Page.navigate': {
      const url = stringParam(params, 'url');
      if (url === undefined || !isOpenableUrl(url)) return Promise.reject(notWebPage());
      return send(method, params);
    }
    case 'Page.navigateToHistoryEntry':
      return historyEntry(params, send);
    default:
      return undefined;
  }
}

async function historyEntry(params: CdpParams, send: SessionSend): Promise<object> {
  const entryId = params['entryId'];
  const history = await send('Page.getNavigationHistory', {});
  if (!Value.Check(HistorySchema, history))
    throw new CdpError("The tab's history could not be checked.");
  const entry = history.entries.find((candidate) => candidate.id === entryId);
  if (entry === undefined)
    throw new CdpError('No history entry with given id found.', CDP_ERROR.invalidParams);
  if (!isOpenableUrl(entry.url)) throw notWebPage();
  return send('Page.navigateToHistoryEntry', params);
}

function notWebPage(): CdpError {
  return new CdpError('Atd for Chrome navigates tabs only to web pages.', CDP_ERROR.invalidParams);
}
