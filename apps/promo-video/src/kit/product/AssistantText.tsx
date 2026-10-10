import { clamp01 } from '../../motion/ease.ts';
import { layOut, type LaidBlock, type RichBlock, type Run } from './rich.ts';
import { revealHead, unitAlpha } from './text.ts';
import './tokens.css';
import './assistant.css';

export interface AssistantTextProps {
  /** The reply, top to bottom (`rich.ts`). */
  content: readonly RichBlock[];
  /**
   * How much has streamed, 0 → 1. Text arrives a word at a time (a character at a time in Chinese)
   * behind a soft head: the newest few units are still fading in. Blocks appear as their first unit
   * does, so the reply grows the way a streamed answer does.
   */
  progress?: number | undefined;
  /** Lights the `{ mark }` runs, 0 → 1. */
  highlight?: number | undefined;
}

function RunView({ run, shown }: { run: Run; shown: number }) {
  if (run.start >= shown) return null;
  const units = run.units.map((unit, index) => {
    const at = run.start + index;
    if (at >= shown) return null;
    return (
      <span key={index} className="pk-unit" style={{ '--a': unitAlpha(at, shown) }}>
        {unit}
      </span>
    );
  });
  switch (run.kind) {
    case 'text':
      return <>{units}</>;
    case 'bold':
      return <strong>{units}</strong>;
    case 'code':
      return <code className="pk-reply__code">{units}</code>;
    case 'mark':
      return <mark className="pk-reply__mark">{units}</mark>;
    default: {
      const exhaustive: never = run.kind;
      return exhaustive;
    }
  }
}

function Runs({ runs, shown }: { runs: readonly Run[]; shown: number }) {
  return (
    <>
      {runs.map((run, index) => (
        <RunView key={index} run={run} shown={shown} />
      ))}
    </>
  );
}

/** Whether a block has begun to stream: its first unit is past the head. */
function started(block: LaidBlock, shown: number): boolean {
  const first =
    block.kind === 'p'
      ? block.runs[0]
      : block.kind === 'list'
        ? block.items[0]?.[0]
        : block.head[0];
  return first !== undefined && first.start < shown;
}

/**
 * An assistant reply (`.assistant-message` and `.markdown` in agent.css): 14/24 text in the
 * foreground, 12 pt between blocks, bold at 600, inline code as a faint chip, and tables in the
 * app's rounded frame at 12 pt.
 */
export function AssistantText({ content, progress = 1, highlight = 0 }: AssistantTextProps) {
  const { blocks, total } = layOut(content);
  const shown = revealHead(progress, total);
  return (
    <div className="pk-reply" style={{ '--mark': clamp01(highlight) }}>
      {blocks.map((block, index) => {
        if (!started(block, shown)) return null;
        switch (block.kind) {
          case 'p':
            return (
              <p key={index}>
                <Runs runs={block.runs} shown={shown} />
              </p>
            );
          case 'list':
            return (
              <ul key={index}>
                {block.items.map((item, row) =>
                  item[0] && item[0].start < shown ? (
                    <li key={row}>
                      <Runs runs={item} shown={shown} />
                    </li>
                  ) : null,
                )}
              </ul>
            );
          case 'table':
            return (
              <div key={index} className="pk-reply__table">
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, column) => (
                        <th key={column}>
                          <RunView run={cell} shown={shown} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, line) =>
                      row[0] && row[0].start < shown ? (
                        <tr key={line}>
                          {row.map((cell, column) => (
                            <td key={column}>
                              <RunView run={cell} shown={shown} />
                            </td>
                          ))}
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
            );
          default: {
            const exhaustive: never = block;
            return exhaustive;
          }
        }
      })}
    </div>
  );
}
