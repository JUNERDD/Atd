import type { Lang } from '../../../copy.ts';
import { MacWindow } from '../../../kit/world/MacWindow.tsx';
import { graphemes, langTag } from '../../../kit/world/text-units.ts';
import { ramp } from '../../../motion/ease.ts';
import { isTyping, typedAt } from '../../world/typing.ts';
import type { DemoId } from './beats.ts';
import type { DemoContent } from './content.ts';
import { DEMO, DEMO_TEXT } from './layout.ts';
import { FieldCaret } from './NoteWindow.tsx';

interface DemoFieldProps {
  lang: Lang;
  id: DemoId;
  demo: DemoContent;
  t: number;
  /** The answer's per-grapheme times (empty for the fallback). */
  answer: readonly number[];
}

/**
 * A destination's paragraph at `t`, each visibly different: Replace swaps the selection for the
 * answer; Insert after keeps the selected sentence (its wash clearing) and adds the answer after
 * a space; Insert at the cursor types at a blinking caret with nothing selected; the fallback's
 * read-only page stays as it is, still selected (its answer waits on the island's card).
 */
function Paragraph({ id, demo, t, answer }: Omit<DemoFieldProps, 'lang'>) {
  const started = t >= (answer[0] ?? Infinity);
  const typed = graphemes(demo.answer).slice(0, typedAt(answer, t)).join('');
  const caret = <FieldCaret t={t} solid={isTyping(answer, t)} />;
  const selected = (fade = 0) => (
    <span className="r08-wb-sel" style={{ '--wash': 1 - fade }}>
      {demo.target}
    </span>
  );
  switch (id) {
    case 'replaceSelection':
      return started ? (
        <>
          {demo.before}
          {typed}
          {caret}
          {demo.after}
        </>
      ) : (
        <>
          {demo.before}
          {selected()}
          {demo.after}
        </>
      );
    case 'insertAfterSelection':
      return (
        <>
          {demo.before}
          {selected(ramp(t, answer[0] ?? Infinity, 0.25))}
          {started ? (
            <>
              {' '}
              <span className="r08-wb-new">{typed}</span>
              {caret}
            </>
          ) : null}
          {demo.after}
        </>
      );
    case 'insertAtCursor':
      return (
        <>
          {demo.before}
          <span className="r08-wb-new">{typed}</span>
          {caret}
          {demo.after}
        </>
      );
    case 'unwritten':
      return (
        <>
          {demo.before}
          {selected()}
          {demo.after}
        </>
      );
  }
}

/** One destination demo: a glass window with a first line and the paragraph the answer lands in. */
export function DemoField({ lang, id, demo, t, answer }: DemoFieldProps) {
  return (
    <MacWindow box={DEMO} title={demo.title} material="glass">
      <div
        className="r08-wb-demo"
        lang={langTag(lang)}
        style={{
          '--left': DEMO_TEXT.left - DEMO.x,
          '--width': DEMO_TEXT.width,
          '--size': DEMO_TEXT.size,
          '--line': DEMO_TEXT.line,
        }}
      >
        {demo.lead ? <p className="r08-wb-demo__lead">{demo.lead}</p> : null}
        <p className="r08-wb-demo__text">
          <Paragraph id={id} demo={demo} t={t} answer={answer} />
        </p>
      </div>
    </MacWindow>
  );
}
