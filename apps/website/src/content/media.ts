import urls from 'virtual:atd-media';

/** Resolve a public media source through the shared client/prerender content address. */
export function mediaUrl(path: string): string {
  const url = urls[path.replace(/^\//, '')];
  if (!url) throw new Error(`Unknown website media: ${path}`);
  return url;
}
