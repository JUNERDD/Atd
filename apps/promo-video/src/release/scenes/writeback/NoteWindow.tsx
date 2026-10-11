import type { Lang } from '../../../copy.ts';
import { langTag, graphemes } from '../../../kit/world/text-units.ts';
import { MacWindow } from '../../../kit/world/MacWindow.tsx';
import { blinkAt, isTyping, typedAt } from '../../world/typing.ts';
import type { WritebackContent } from './content.ts';
import { NOTE, NOTE_TEXT } from './layout.ts';

interface NoteWindowProps {
  lang: Lang;
  c: WritebackContent;
  t: number;
  /** Graphemes selected on each rough line (the drag), until the answer replaces them. */
  selection: readonly number[];
  /** The polished answer's per-grapheme times; from the first, it replaces the selection. */
  answer: readonly number[];
}

/** A rough line, its selected start drawn in the coral wash the way a text view draws it. */
function RoughLine({ line, selected }: { line: string; selected: number }) {
  const chars = graphemes(line);
  return (
    <p className="r08-wb-note__line">
      {selected > 0 ? (
        <span className="r08-wb-sel">{chars.slice(0, selected).join('')}</span>
      ) : null}
      {chars.slice(selected).join('')}
    </p>
  );
}

/** The insertion point: the coral caret, solid while text arrives, blinking on the beat after. */
export function FieldCaret({ t, solid }: { t: number; solid: boolean }) {
  return <span className="r08-wb-caret" style={{ '--o': solid ? 1 : blinkAt(t) }} />;
}

/**
 * The note: a glass window with a title, a meta line, the rough paragraph set line by line (so
 * the drag can select it character by character) and a next paragraph. Once the answer starts,
 * the selected paragraph is replaced by the polished text arriving chunk by chunk, wrapping and
 * reflowing what follows, with the insertion point riding its end.
 */
export function NoteWindow({ lang, c, t, selection, answer }: NoteWindowProps) {
  const writing = t >= (answer[0] ?? Infinity);
  const typed = graphemes(c.note.polished).slice(0, typedAt(answer, t)).join('');
  return (
    <MacWindow box={NOTE} title={c.app} material="glass">
      <div
        className="r08-wb-note"
        lang={langTag(lang)}
        style={{
          '--left': NOTE_TEXT.left - NOTE.x,
          '--width': NOTE_TEXT.width,
          '--size': NOTE_TEXT.size,
          '--line': NOTE_TEXT.line,
        }}
      >
        <h3 className="r08-wb-note__title">{c.note.title}</h3>
        <p className="r08-wb-note__meta">{c.note.meta}</p>
        <div className="r08-wb-note__paragraph">
          {writing ? (
            <p className="r08-wb-note__flow">
              {typed}
              <FieldCaret t={t} solid={isTyping(answer, t)} />
            </p>
          ) : (
            c.note.rough.map((line, index) => (
              <RoughLine key={line} line={line} selected={selection[index] ?? 0} />
            ))
          )}
        </div>
        <p className="r08-wb-note__next">{c.note.next}</p>
      </div>
    </MacWindow>
  );
}
