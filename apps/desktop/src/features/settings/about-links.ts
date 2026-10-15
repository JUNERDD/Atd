/**
 * The public places the About page links to, in page order. The URLs are the product's own,
 * matching the website's facts (`apps/website/src/content/site.ts`) and the production origin in
 * `apps/website/README.md`; change them there and here together.
 */
export const aboutLinks = [
  { id: 'website', url: 'https://atd.best' },
  { id: 'repository', url: 'https://github.com/JUNERDD/Atd' },
  { id: 'issues', url: 'https://github.com/JUNERDD/Atd/issues' },
] as const satisfies readonly { id: string; url: string }[];
