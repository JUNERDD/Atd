import { createElement, useMemo } from 'react';
import { TextSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { EmptyResult, PlainResult, SearchFrame } from './search-frame';
import { grepMatcher, highlightSegments } from './search-highlight';
import { pathGlyph, pathParts } from './search-path';
import { parseGrep, splitNotice, type GrepFile } from './tool-output';

/** Pi's sentence for a search that matched nothing. */
const NO_MATCHES = 'No matches found';

/**
 * One line of a file group: its number in the shared gutter, then the text. Match lines read in
 * the foreground with each occurrence of the pattern marked; context lines step back to muted.
 * `gap` opens a little space where context mode skipped lines between two blocks.
 */
function GrepLineRow({
  line,
  text,
  match,
  gap,
  matcher,
}: {
  line: number;
  text: string;
  match: boolean;
  gap: boolean;
  matcher: RegExp | null;
}) {
  const segments = match ? highlightSegments(text, matcher) : [{ text, match: false }];
  return (
    <li className="tool-grep-line" data-match={match} data-gap={gap || undefined}>
      <span className="tool-grep-gutter">{line}</span>
      <span className="tool-grep-text font-mono">
        {segments.map((segment, index) =>
          segment.match ? (
            <mark key={index} className="tool-grep-mark">
              {segment.text}
            </mark>
          ) : (
            segment.text
          ),
        )}
      </span>
    </li>
  );
}

/** A file's matches under a row naming the file, its folder, and how many lines matched. */
function GrepFileGroup({ file, matcher }: { file: GrepFile; matcher: RegExp | null }) {
  const parts = pathParts(file.path);
  const matches = file.lines.filter((line) => line.match).length;
  // Context mode prints neighbouring lines; only then does a jump in numbers mark a skipped run.
  const contextMode = file.lines.some((line) => !line.match);
  return (
    <li className="tool-grep-file">
      <div className="tool-list-row" title={file.path}>
        {createElement(pathGlyph(parts), { 'aria-hidden': true, className: 'tool-list-glyph' })}
        <span className="tool-list-name font-mono">{parts.name}</span>
        <span className="tool-list-dir font-mono">{parts.dir}</span>
        <span className="tool-list-count">{matches}</span>
      </div>
      <ol className="tool-grep-lines">
        {file.lines.map((line, index) => {
          const previous = file.lines[index - 1];
          return (
            <GrepLineRow
              key={`${index}:${line.line}`}
              line={line.line}
              text={line.text}
              match={line.match}
              gap={contextMode && previous !== undefined && line.line > previous.line + 1}
              matcher={matcher}
            />
          );
        })}
      </ol>
    </li>
  );
}

/**
 * A `grep` call: results grouped by file, with line numbers in one gutter shared by the whole
 * card and the searched pattern marked in each match line. The header names the pattern and the
 * tally; Pi's limit notice closes the card. Text that does not parse as grep output (an error, an
 * unexpected format) reads as it came.
 */
export function GrepBody({ block }: { block: BlockOf<'tool'> }) {
  const { t } = useTranslation('tasks');
  const text = block.status === 'running' ? block.partial : block.output;
  const settled = block.status !== 'failed' && block.status !== 'declined';
  const parsed = useMemo(() => (settled ? parseGrep(text) : null), [settled, text]);
  const matcher = useMemo(() => grepMatcher(block.args), [block.args]);
  const { body, notice } = splitNotice(text);
  const empty = settled && body.trim() === NO_MATCHES;
  const pattern = typeof block.args.pattern === 'string' ? block.args.pattern : '';
  const meta = parsed
    ? t('toolList.matchesInFiles', {
        matches: t('toolCount.match', { count: parsed.matchCount }),
        files: t('toolCount.file', { count: parsed.files.length }),
      })
    : undefined;

  let content = null;
  if (parsed)
    content = (
      <ul className="tool-grep">
        {parsed.files.map((file, index) => (
          <GrepFileGroup key={`${index}:${file.path}`} file={file} matcher={matcher} />
        ))}
      </ul>
    );
  else if (empty) content = <EmptyResult>{t('toolList.noMatches')}</EmptyResult>;
  else if (text) content = <PlainResult text={text} />;

  return (
    <SearchFrame
      block={block}
      text={text}
      icon={<TextSearch />}
      label={<span className="font-mono">{pattern}</span>}
      meta={meta}
      notice={parsed || empty ? notice : null}
    >
      {content}
    </SearchFrame>
  );
}
