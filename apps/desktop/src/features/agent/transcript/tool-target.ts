import { WEB_FETCH_TOOL } from '@atd/agent-contracts';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { bashCommand } from './tool-copy';

/** How a settled row shows its target: visible text, full value for the tooltip, and its face. */
export interface TargetPresentation {
  text: string;
  title: string;
  /** Commands and search patterns are code, so they read in the monospace face. */
  code: boolean;
}

/**
 * Presentation of a row's raw target (`toolTarget`). A shell row shows the command's first line
 * and keeps the whole command in the tooltip; a fetched URL reads as host and path, with the full
 * URL in the tooltip. Every other target shows as is.
 */
export function presentTarget(block: BlockOf<'tool'>, target: string): TargetPresentation {
  switch (block.name) {
    case 'bash':
      return { text: target, title: bashCommand(block.args) || target, code: true };
    case 'grep':
    case 'find':
      return { text: target, title: target, code: true };
    case WEB_FETCH_TOOL:
      return { text: urlLabel(target), title: target, code: false };
    default:
      return { text: target, title: target, code: false };
  }
}

/**
 * An http(s) URL as `host/path`: no scheme, no leading `www.`, no query or fragment, no trailing
 * slash. The row truncates the end, so the host always stays visible. Anything that does not parse
 * as an http(s) URL is returned unchanged.
 */
export function urlLabel(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;
  const host = url.host.replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  return `${host}${readablePath(path)}`;
}

/** Percent-escapes decoded for reading; a malformed escape keeps the path as sent. */
function readablePath(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}
