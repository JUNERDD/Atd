/**
 * The rich markdown renderer (Streamdown, `@pierre/diffs`, Shiki) is a separate chunk: it is most
 * of the panel's script weight and nothing needs it before the first paint. Eagerly loaded surfaces
 * render through `LazyMarkdown`, which shows the plain text until this loader settles; only code
 * that is itself split off may import `./markdown` directly. The panel entry starts the load with
 * its own tree, so transcripts normally find the renderer ready.
 */

type MarkdownModule = typeof import('./markdown');

let loaded: MarkdownModule | null = null;
let pending: Promise<MarkdownModule | null> | null = null;

/** The renderer once its chunk has loaded; `null` before that or after a failed load. */
export function loadedMarkdown(): MarkdownModule | null {
  return loaded;
}

/**
 * Starts (or joins) the chunk load. A failed load resolves `null`, so text stays readable as
 * plain prose instead of taking the transcript down with it.
 */
export function loadMarkdown(): Promise<MarkdownModule | null> {
  pending ??= import('./markdown').then(
    (module) => {
      loaded = module;
      return module;
    },
    () => null,
  );
  return pending;
}
