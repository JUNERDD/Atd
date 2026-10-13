import type { ReactNode } from 'react';
import type { Lang } from '../../../copy.ts';
import { langTag } from '../../../kit/world/text-units.ts';
import { Caret } from '../../world/Caret.tsx';
import { centeredTypeAt, type CenteredTypeInput } from './centered-type.ts';
import './centered-type.css';

interface CenteredTypeProps extends CenteredTypeInput {
  lang: Lang;
  tone?: 'fg' | 'muted';
  /** When the caret shows (default always), and its bloom (default the caret's own). */
  caret?: { from?: number; until?: number; glow?: number } | false;
  /** The lead's picture, drawn left-aligned in a box `lead.width` px wide once `lead.at` passes. */
  leadNode?: ReactNode;
}

/**
 * A line typed in a centered paragraph with the coral caret (see `centered-type.ts`): the caret
 * starts at the anchor and the line glides to stay centered as it grows, with an optional drag
 * selection in the coral wash, an in-place rewrite, and a lead glyph. A zero-size anchor: the
 * parent places it at the line's center.
 */
export function CenteredType(props: CenteredTypeProps) {
  const { t, lang, set, tone = 'fg', caret = {}, lead, leadNode } = props;
  const state = centeredTypeAt(props);
  const caretShown =
    caret !== false &&
    !state.selecting &&
    t >= (caret.from ?? -Infinity) &&
    t < (caret.until ?? Infinity);
  return (
    <div
      className="r08-ct"
      data-tone={tone}
      lang={langTag(lang)}
      style={{
        '--ct-size': `${set.size}px`,
        '--ct-weight': set.weight,
        '--ct-track': `${set.tracking}em`,
        '--ct-shift': `${state.shift}px`,
      }}
    >
      <div className="r08-ct__row">
        {lead && state.leadShown ? (
          <span className="r08-ct__lead" style={{ '--lead-w': `${lead.width}px` }}>
            {leadNode}
          </span>
        ) : null}
        <span className="r08-ct__text">
          {state.runs.map((run, index) =>
            run.text === '' ? null : (
              <span key={`${index}-${run.kind}`} className="r08-ct__run" data-kind={run.kind}>
                {run.text}
              </span>
            ),
          )}
          {caretShown ? (
            <span className="r08-ct__caret">
              <Caret
                t={t}
                solid={state.typing}
                {...(caret.glow === undefined ? {} : { glow: caret.glow })}
              />
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
