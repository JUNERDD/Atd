import type { BlogBlock, BlogInline, BlogPost } from '../src/content/blog-schema.ts';
import { site } from '../src/content/site.ts';
import { feedPath } from '../src/head.ts';
import { htmlLang, pagePath, postSlugOf, type Lang, type Page } from '../src/i18n/routes.ts';
import { blogCopy } from '../src/pages/blog/copy.ts';

export interface IndexedRoute {
  lang: Lang;
  page: Page;
  path: string;
  hreflang: string;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function inlineToText(nodes: readonly BlogInline[]): string {
  return nodes
    .map((node) => {
      if (typeof node === 'string') return node;
      if (node.kind === 'code') return `\`${node.text}\``;
      if (node.kind === 'link') return `${inlineToText(node.children)} (${node.href})`;
      return inlineToText(node.children);
    })
    .join('');
}

function blockToMarkdown(block: BlogBlock): string {
  if (block.kind === 'paragraph') return inlineToText(block.children);
  return block.items
    .map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${inlineToText(item)}`)
    .join('\n');
}

function toRfc2822(date: string): string {
  return new Date(`${date}T00:00:00Z`).toUTCString();
}

/**
 * Generates `sitemap.xml` with symmetric `hreflang` alternates (`en`, `zh-CN`, `x-default`) and
 * `<lastmod>` derived from the release posts' publication dates.
 */
export function buildSitemapXml(
  origin: string,
  indexedRoutes: readonly IndexedRoute[],
  posts: readonly BlogPost[],
): string {
  const latestDate = posts[0]?.date ?? new Date().toISOString().slice(0, 10);
  const postDates = new Map(posts.map((post) => [post.slug, post.date]));

  const alternatesOf = (page: Page) => {
    const versions = indexedRoutes.filter((route) => route.page === page);
    const fallback = versions.find((route) => route.lang === 'en');
    if (!fallback)
      throw new Error(`The English ${page} page, the x-default alternate, is missing.`);
    return [...versions.map((route) => [route.hreflang, route.path]), ['x-default', fallback.path]]
      .map(
        ([hreflang, path]) =>
          `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${escapeXml(`${origin}${path}`)}" />`,
      )
      .join('\n');
  };

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...indexedRoutes.map((route) => {
      const slug = postSlugOf(route.page);
      const lastmod = slug !== null ? (postDates.get(slug) ?? latestDate) : latestDate;
      return [
        '  <url>',
        `    <loc>${escapeXml(`${origin}${route.path}`)}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        alternatesOf(route.page),
        '  </url>',
      ].join('\n');
    }),
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Generates an RSS 2.0 feed for one language's release blog (`/feed.xml` or `/zh/feed.xml`).
 */
export function buildRssFeedXml(origin: string, lang: Lang, posts: readonly BlogPost[]): string {
  const blogUrl = `${origin}${pagePath(lang, 'blog')}`;
  const selfUrl = `${origin}${feedPath(lang)}`;
  const latestDate = posts[0]?.date ?? new Date().toISOString().slice(0, 10);
  const items = posts
    .map((post) => {
      const copy = post.copy[lang];
      const url = `${origin}${pagePath(lang, `blog/${post.slug}`)}`;
      const highlights = copy.highlights.map((highlight) => highlight.title).join(' · ');
      const description = highlights ? `${copy.summary}\n\n${highlights}` : copy.summary;
      return [
        '    <item>',
        `      <title>${escapeXml(`${copy.title} — Atd ${post.version}`)}</title>`,
        `      <link>${escapeXml(url)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
        `      <pubDate>${toRfc2822(post.date)}</pubDate>`,
        `      <description>${escapeXml(description)}</description>`,
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(blogCopy[lang].rssTitle)}</title>`,
    `    <link>${escapeXml(blogUrl)}</link>`,
    `    <description>${escapeXml(blogCopy[lang].headDescription)}</description>`,
    `    <language>${htmlLang[lang]}</language>`,
    `    <lastBuildDate>${toRfc2822(latestDate)}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

/**
 * Generates `llms.txt` at build time with canonical URLs, version, installers, and release links.
 */
export function buildLlmsTxt(origin: string, posts: readonly BlogPost[]): string {
  const [appleSilicon, intel] = site.downloads;
  return [
    `# ${site.name}`,
    '',
    `> Atd (anything, anytime, anywhere, to do) is a free, open-source macOS AI desktop agent (current stable v${site.version}, MIT licensed). Press ${site.shortcut.join(' ')} anywhere on macOS ${appleSilicon.minMacOS}+ (Apple silicon or Intel) to run coding, computer use, MCP/skill workflows, screenshot and screen-recording captures, and everyday automation using cloud or local models.`,
    '',
    '## Core Pages',
    '',
    `- [Website (English)](${origin}/): product overview, interactive workflow showcase, capabilities, and installers`,
    `- [Website (简体中文)](${origin}/zh): product overview and installers in Simplified Chinese`,
    `- [Blog & Release Notes (English)](${origin}/blog): version updates, newest first ([RSS feed](${origin}/feed.xml))`,
    `- [博客与更新日志 (简体中文)](${origin}/zh/blog): release notes in Simplified Chinese ([RSS feed](${origin}/zh/feed.xml))`,
    `- [Full LLM Reference](${origin}/llms-full.txt): complete plain-text product summary and release history`,
    '',
    '## Downloads & Source',
    '',
    `- [Download for Apple silicon](${appleSilicon.url}): macOS ${appleSilicon.minMacOS}+ native dmg (\`Atd-<version>-arm64.dmg\`)`,
    `- [Download for Intel](${intel.url}): macOS ${intel.minMacOS}+ native dmg (\`Atd-<version>-x64.dmg\`)`,
    `- [Preview builds (Apple silicon)](${appleSilicon.previewUrl}) and [Intel](${intel.previewUrl}): latest release candidate when newer than stable`,
    `- [Source on GitHub](${site.repoUrl}): macOS shell, React UI, and local agent service`,
    `- [GitHub Releases](${site.releasesUrl}): versioned release notes and dmg downloads`,
    '',
    '## Release Notes',
    '',
    ...posts.map(
      (post) =>
        `- [Atd ${post.version} — ${post.copy.en.title}](${origin}${pagePath('en', `blog/${post.slug}`)}): ${post.copy.en.summary} ([中文](${origin}${pagePath('zh', `blog/${post.slug}`)}))`,
    ),
    '',
  ].join('\n');
}

/**
 * Generates `llms-full.txt` expanding product specifications and all release notes into clean Markdown.
 */
export function buildLlmsFullTxt(origin: string, posts: readonly BlogPost[]): string {
  const postSections = posts.flatMap((post) => {
    const copy = post.copy.en;
    const lines = [
      `### Atd ${post.version} (${post.date}) — ${copy.title}`,
      '',
      `- English: ${origin}${pagePath('en', `blog/${post.slug}`)}`,
      `- 简体中文: ${origin}${pagePath('zh', `blog/${post.slug}`)}`,
      '',
      copy.summary,
      '',
    ];
    for (const highlight of copy.highlights) {
      lines.push(`#### ${highlight.title}`, '');
      for (const block of highlight.blocks) {
        lines.push(blockToMarkdown(block), '');
      }
    }
    const addNotes = (heading: string, items: typeof copy.improvements) => {
      if (items.length === 0) return;
      lines.push(`#### ${heading}`, '');
      for (const item of items) lines.push(`- ${inlineToText(item.content)}`);
      lines.push('');
    };
    addNotes('Improvements', copy.improvements);
    addNotes('Fixes', copy.fixes);
    addNotes('Other', copy.other);
    return lines;
  });

  return [
    `# ${site.name} — Complete Product & Release Reference`,
    '',
    `Origin: ${origin}`,
    `Repository: ${site.repoUrl}`,
    `Current version: v${site.version}`,
    `License: ${site.license} (${site.licenseUrl})`,
    'Platform: macOS 15 or later (Apple silicon & Intel)',
    `Global shortcut: ${site.shortcut.join(' ')}`,
    '',
    '## Key Capabilities',
    '',
    '- Selection toolbar: ask Atd or execute inline commands beside any selected text, with quick option controls and in-place write-back at the caret.',
    '- Screen captures & recordings: annotated screenshots, live scrolling long screenshots, inline commands directly on text inside captures, and step-aware screen recording with timeline trimming.',
    '- Agent panel & Mini Panel: floating main panel supporting dragged files and `@` conversation references, transparent tool/subagent inspection, and edge Mini Panel tracking.',
    '- Computer use, Apps & Automations: permission-gated UI control of Mac apps, turning prompts into personal mini apps, and scheduled recurring automations.',
    '- Extensions & privacy: custom Skills, subagents, MCP servers, slash commands, locally stored reviewable Memory, and cloud or local model endpoints without an Atd account.',
    '',
    '## Release History',
    '',
    ...postSections,
  ].join('\n');
}
