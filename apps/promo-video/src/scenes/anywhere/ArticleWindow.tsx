import { BookmarkPlus, Share } from 'lucide-react';
import { MacWindow } from '../../kit/world/MacWindow.tsx';
import type { AnywhereContent } from './content.ts';
import { ARTICLE, BLOCKS, COLUMN, TEXT } from './layout.ts';

interface ArticleWindowProps {
  c: AnywhereContent;
  /** Characters selected on each of the selected paragraph's lines. */
  selection: readonly number[];
  focused?: boolean;
}

/** A paragraph's set lines, each at its own top in the body's points. */
function Lines({
  lines,
  top,
  selection,
}: {
  lines: readonly string[];
  top: number;
  selection?: readonly number[];
}) {
  return (
    <>
      {lines.map((line, index) => {
        const chars = Array.from(line);
        const count = selection?.[index] ?? 0;
        return (
          <p key={index} className="aw-line" style={{ '--top': top + index * TEXT.line }}>
            {count > 0 ? (
              <span className="aw-line__sel">{chars.slice(0, count).join('')}</span>
            ) : null}
            {chars.slice(count).join('')}
          </p>
        );
      })}
    </>
  );
}

/**
 * The reading app: an article in a single column, every line set on its own so the selection can
 * be drawn the way a text view draws it, character by character behind the pointer.
 */
export function ArticleWindow({ c, selection, focused = true }: ArticleWindowProps) {
  const { article } = c;
  const paragraphTop = (index: number, from: number, list: readonly (readonly string[])[]) =>
    list.slice(0, index).reduce((top, lines) => top + lines.length * TEXT.line + BLOCKS.gap, from);
  const afterFrom = BLOCKS.selected + article.selected.length * TEXT.line + BLOCKS.gap;
  return (
    <MacWindow
      box={ARTICLE}
      title={article.site}
      focused={focused}
      toolbar={
        <span className="aw-tools">
          <BookmarkPlus className="aw-tools__icon" />
          <Share className="aw-tools__icon" />
        </span>
      }
    >
      <article className="aw-article" style={{ '--left': COLUMN.left, '--width': COLUMN.width }}>
        <span className="aw-article__kicker" style={{ '--top': BLOCKS.kicker }}>
          {article.kicker}
        </span>
        <h2 className="aw-article__title" style={{ '--top': BLOCKS.title }}>
          {article.title}
        </h2>
        <div className="aw-article__dek" style={{ '--top': BLOCKS.dek }}>
          {article.dek.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
        <span className="aw-article__byline" style={{ '--top': BLOCKS.byline }}>
          {article.byline}
        </span>
        <i className="aw-article__rule" style={{ '--top': BLOCKS.rule }} />
        {article.before.map((lines, index) => (
          <Lines
            key={index}
            lines={lines}
            top={paragraphTop(index, BLOCKS.before, article.before)}
          />
        ))}
        <Lines lines={article.selected} top={BLOCKS.selected} selection={selection} />
        {article.after.map((lines, index) => (
          <Lines key={index} lines={lines} top={paragraphTop(index, afterFrom, article.after)} />
        ))}
      </article>
    </MacWindow>
  );
}
