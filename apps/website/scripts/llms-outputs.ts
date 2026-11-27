/**
 * The plain-text references for language models written beside the pages: `llms.txt`, an index
 * of the site's pages with one line each, and `llms-full.txt`, the English content of the
 * capability pages, the FAQ and every release post. The crawler-facing files are in
 * `seo-outputs.ts`.
 */
import type { BlogBlock, BlogInline, BlogPost } from '../src/content/blog-schema.ts';
import { faq, type FaqPage } from '../src/content/faq/index.ts';
import { featurePage, featurePages, featuresHub } from '../src/content/features/index.ts';
import { site } from '../src/content/site.ts';
import { pagePath, type Page } from '../src/i18n/routes.ts';

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

/** An index line: the English page, what it holds, and its Chinese edition. */
function indexLine(origin: string, page: Page, name: string, summary: string): string {
  return `- [${name}](${origin}${pagePath('en', page)}): ${summary} ([中文](${origin}${pagePath('zh', page)}))`;
}

/** Both editions' URLs, under a heading of `llms-full.txt`. */
function editionLines(origin: string, page: Page): string[] {
  return [
    `- English: ${origin}${pagePath('en', page)}`,
    `- 简体中文: ${origin}${pagePath('zh', page)}`,
  ];
}

/**
 * Generates `llms.txt` at build time with canonical URLs, version, installers, and release links.
 */
export function buildLlmsTxt(origin: string, posts: readonly BlogPost[]): string {
  const [appleSilicon, intel] = site.downloads;
  return [
    `# ${site.name}`,
    '',
    `> Atd (anything, anytime, anywhere, to do) is a free, open-source macOS AI desktop agent (current stable v${site.version}, MIT licensed, Developer ID signed and notarized by Apple). Press ${site.shortcut.join(' ')} anywhere on macOS ${appleSilicon.minMacOS}+ (Apple silicon or Intel) to run coding, computer use, MCP/skill workflows, screenshot and screen-recording captures, and everyday automation using cloud or local models.`,
    '',
    '## Core Pages',
    '',
    `- [Website (English)](${origin}/): product overview, interactive workflow showcase, capabilities, and installers`,
    `- [Website (简体中文)](${origin}/zh): product overview and installers in Simplified Chinese`,
    `- [Blog & Release Notes (English)](${origin}/blog): version updates, newest first ([RSS feed](${origin}/feed.xml))`,
    `- [博客与更新日志 (简体中文)](${origin}/zh/blog): release notes in Simplified Chinese ([RSS feed](${origin}/zh/feed.xml))`,
    indexLine(origin, 'faq', faq.copy.en.title, faq.copy.en.headDescription),
    `- [Full LLM Reference](${origin}/llms-full.txt): complete plain-text product summary, capability pages, FAQ, and release history`,
    '',
    '## Features',
    '',
    indexLine(origin, 'features', featuresHub.copy.en.title, featuresHub.copy.en.headDescription),
    ...featurePages.map((feature) =>
      indexLine(origin, `features/${feature.slug}`, feature.copy.en.name, feature.copy.en.summary),
    ),
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

/** Every capability page's English content: lede, sections with their points, then questions. */
function featureSections(origin: string): string[] {
  return featurePages.flatMap((feature) => {
    const copy = feature.copy.en;
    const lines = [
      `### ${copy.title}`,
      '',
      ...editionLines(origin, `features/${feature.slug}`),
      '',
      copy.lede,
      '',
    ];
    for (const section of copy.sections) {
      lines.push(`#### ${section.title}`, '', ...section.paragraphs.flatMap((text) => [text, '']));
      if (section.points && section.points.length > 0)
        lines.push(...section.points.map((point) => `- ${point}`), '');
    }
    if (copy.questions.length > 0) {
      lines.push('#### Questions', '');
      for (const entry of copy.questions) lines.push(`**${entry.question}**`, '', entry.answer, '');
    }
    return lines;
  });
}

/** The FAQ's English questions and answers by group, each linking the page that covers it. */
function faqSections(origin: string): string[] {
  // Read through the contract type: the content's literal type omits fields no entry sets yet.
  const page: FaqPage = faq;
  return page.groups.flatMap((group) => [
    `### ${group.title.en}`,
    '',
    ...group.entries.flatMap((entry) => {
      const see = entry.see === undefined ? undefined : featurePage(entry.see);
      return [
        `#### ${entry.question.en}`,
        '',
        ...entry.answer.en.flatMap((text) => [text, '']),
        ...(see
          ? [`See: ${see.copy.en.name} (${origin}${pagePath('en', `features/${see.slug}`)})`, '']
          : []),
      ];
    }),
  ]);
}

/** Every release post's English notes, newest first. */
function releaseSections(origin: string, posts: readonly BlogPost[]): string[] {
  return posts.flatMap((post) => {
    const copy = post.copy.en;
    const lines = [
      `### Atd ${post.version} (${post.date}) — ${copy.title}`,
      '',
      ...editionLines(origin, `blog/${post.slug}`),
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
}

/**
 * Generates `llms-full.txt`: the product summary, the capability pages and the FAQ in English,
 * then the release history as clean Markdown.
 */
export function buildLlmsFullTxt(origin: string, posts: readonly BlogPost[]): string {
  return [
    `# ${site.name} — Complete Product & Release Reference`,
    '',
    `Origin: ${origin}`,
    `Repository: ${site.repoUrl}`,
    `Current version: v${site.version}`,
    `License: ${site.license} (${site.licenseUrl})`,
    'Platform: macOS 15 or later (Apple silicon & Intel, Developer ID signed and notarized by Apple)',
    `Global shortcut: ${site.shortcut.join(' ')}`,
    '',
    '## Key Capabilities',
    '',
    '- Selection toolbar: ask Atd or execute inline commands beside any selected text, with quick option controls, floating Markdown result cards, and in-place write-back at the caret.',
    '- Screen captures & recordings: annotated screenshots with Smart Shapes and floating pins across Spaces, live scrolling long screenshots, inline commands directly on text inside captures, and step-aware screen recording with timeline trimming.',
    '- Agent panel & Mini Panel: floating main panel supporting dragged files and `@` conversation references, transparent tool/subagent inspection, and edge Mini Panel tracking.',
    '- Computer use, Apps & Automations: permission-gated UI control of Mac apps and websites, turning prompts into personal mini apps with widgets, and scheduled, folder-triggered, idle, or chained automations.',
    '- Extensions, models & diagnostics: custom Skills, subagents, MCP servers, slash commands, reusable model aliases (`⌘ ⇧ M` / `/model`), locally stored reviewable Memory, built-in 7-layer Diagnostics with redacted support bundles, and cloud or local model endpoints without an Atd account.',
    '',
    '## Features',
    '',
    ...editionLines(origin, 'features'),
    '',
    ...featureSections(origin),
    '## Frequently Asked Questions',
    '',
    ...editionLines(origin, 'faq'),
    '',
    ...faqSections(origin),
    '## Release History',
    '',
    ...releaseSections(origin, posts),
  ].join('\n');
}
