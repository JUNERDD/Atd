import { getFiletypeFromFileName } from '@pierre/diffs';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { CodeBlock } from '../agent/transcript/code-block';
import { StreamdownMarkdown } from '../agent/transcript/markdown';

/** A fence longer than any backtick run in the text, so the text cannot close it early. */
function fenced(language: string, text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}\n${fence}`;
}

const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * A Markdown file reads as prose through the transcript's renderer (links open outside, images
 * stay alt text), its frontmatter as a YAML block ahead of it. Any other file is the project's
 * code block, highlighted in the language its name implies.
 */
export function SkillFilePreview({ path, content }: { path: string; content: string }) {
  if (MARKDOWN_FILE.test(path)) {
    const front = FRONTMATTER.exec(content);
    const markdown = front
      ? `${fenced('yaml', front[1] ?? '')}\n\n${content.slice(front[0].length)}`
      : content;
    return (
      <ScrollArea className="skill-browser-body" scrollShadow>
        <div className="skill-browser-content">
          <StreamdownMarkdown text={markdown} streaming={false} />
        </div>
      </ScrollArea>
    );
  }
  // The code block never scrolls itself: this area scrolls it both ways, so a long line's bar
  // stays at the bottom of the visible pane instead of under the file's last line.
  return (
    <ScrollArea orientation="both" className="skill-browser-body" scrollShadow>
      <div className="skill-browser-content">
        <CodeBlock contents={content} language={getFiletypeFromFileName(path)} />
      </div>
    </ScrollArea>
  );
}
