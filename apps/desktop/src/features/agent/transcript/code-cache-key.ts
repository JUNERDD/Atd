/**
 * What a cached result draws: a file's text (`CodeBlock`), a `read` excerpt drawn as one unchanged
 * hunk, or an `edit` diff (`DiffView`). The same text drawn two ways is two different results.
 */
type CodeKind = 'file' | 'excerpt' | 'edit';

/**
 * The key `CodeHighlightPool` caches highlighted code under, so a body that mounts again paints it
 * at once instead of highlighting it again. It names the content, never the call that showed it:
 * what is drawn, the path (which picks the language), the excerpt's first line, and the text's
 * length and hash, so bodies that show the same code share one entry. The path comes last, as the
 * only part that can contain `:`. Key only text that no longer changes: growing text would fill
 * the cache with results nothing reuses.
 */
export function codeCacheKey(kind: CodeKind, path: string, text: string, startLine = 1): string {
  return `${kind}:${startLine}:${text.length}:${hash53(text).toString(36)}:${path}`;
}

/**
 * cyrb53 (bryc, public domain): a fast, well-mixed 53-bit string hash. It is not cryptographic;
 * beside the length and the path, two different texts sharing a key is vanishingly unlikely.
 */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
