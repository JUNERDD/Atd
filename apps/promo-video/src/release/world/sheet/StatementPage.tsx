import { DotField } from '../DotField.tsx';
import { Statement } from '../Statement.tsx';
import { TypeLine } from '../TypeLine.tsx';
import { releaseCopy } from '../../copy.ts';
import { STATEMENT_PAGE } from './beats.ts';
import { content } from './content.ts';

/**
 * The statement page: the title slamming in word by word with a pulse under each, its line typed
 * beneath, and the Chinese line rising from behind its baseline, all leaving with a stagger.
 */
export function StatementPage({ t }: { t: number }) {
  const copy = releaseCopy;
  return (
    <>
      <DotField
        t={t}
        pulses={[
          { x: 760, y: 420, at: STATEMENT_PAGE.title, strength: 1.3 },
          { x: 1160, y: 420, at: STATEMENT_PAGE.title + 0.15, strength: 1 },
        ]}
      />
      <div className="r08-sheet__label">{content.en.labels.statement}</div>
      <div className="r08-sheet__title">
        <Statement
          t={t}
          lang="en"
          text={copy.en.title}
          at={STATEMENT_PAGE.title}
          motion="slam"
          size="hero"
          accent={[1]}
          out={STATEMENT_PAGE.out}
        />
      </div>
      <div className="r08-sheet__titleline">
        <TypeLine
          t={t}
          lang="en"
          text={copy.en.titleLine}
          at={STATEMENT_PAGE.line}
          size="label"
          caret={{ until: STATEMENT_PAGE.out }}
        />
      </div>
      <div className="r08-sheet__zh">
        <Statement
          t={t}
          lang="zh"
          text={copy.zh.choose.hold}
          at={STATEMENT_PAGE.zh}
          out={STATEMENT_PAGE.out + 0.1}
        />
      </div>
    </>
  );
}
