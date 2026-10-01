/** Section headings of an exported turn, in the interface language. */
export interface TurnMarkdownLabels {
  prompt: string;
  answer: string;
}

/**
 * One turn as a Markdown document: the user's message, then the final answer, each under its own
 * heading. The answer is already Markdown and is kept as written; a turn without a message (the
 * opening of a subagent's view) exports the answer alone.
 */
export function turnMarkdown(prompt: string, answer: string, labels: TurnMarkdownLabels): string {
  const sections = prompt.trim() ? [`## ${labels.prompt}`, prompt.trim()] : [];
  sections.push(`## ${labels.answer}`, answer.trim());
  return `${sections.join('\n\n')}\n`;
}

/** Characters macOS or other systems reject in a file name, and control characters. */
const UNSAFE_NAME = /[\\/:*?"<>|\p{Cc}]+/gu;

/** A `.md` file name from the task title, or `fallback` when the title leaves nothing usable. */
export function markdownFileName(title: string, fallback: string): string {
  const base = title.replace(UNSAFE_NAME, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim();
  return `${base.replace(/^\.+/, '') || fallback}.md`;
}

/**
 * An answer as text to read aloud: code blocks, images and Markdown syntax would be read out as
 * symbols, so code blocks are dropped and links, emphasis, headings, lists, quotes and tables keep
 * only their words.
 */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|\*|_|~~)(\S[\s\S]*?\S|\S)\1/g, '$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
