import type { LucideIcon } from 'lucide-react';
import { clamp01 } from '../../motion/ease.ts';
import { arrival, present } from './motion.ts';
import { shimmerAt } from './text.ts';
import './tokens.css';
import './activity.css';

export interface ToolCardProps {
  /**
   * The tool's Lucide mark, as the app maps them (`tool-copy.ts`): `TextSearch` search file
   * contents, `FileSearch` find files, `FileText` read, `FilePen` edit, `FilePlus` write,
   * `Terminal` a command, `Globe` web search, `Brain` memory, `Bot` a subagent, `AppWindow` an app,
   * `Zap` an automation, `SquareTerminal` a saved command, `BookOpen` a skill.
   */
  icon: LucideIcon;
  /** The step's name, in the scene's language ("Search file contents", "Run command"). */
  title: string;
  /** What it acts on, muted after the title: a query, a path, a command. */
  detail?: string | undefined;
  /** The card's header over the output: a file name, a command line. */
  label?: string | undefined;
  /** Output lines the card streams; the newest stay in view, at most `rows` of them. */
  lines?: readonly string[] | undefined;
  /** How many output lines have arrived, 0 → 1. */
  stream?: number | undefined;
  /** The card folding away into the one-line row, 0 → 1. */
  collapse?: number | undefined;
  /** The settled row's trailing fact ("12 matches", "+18 −3", "L1–120"). */
  summary?: string | undefined;
  /** Settled: the shimmer stops and the summary shows. */
  done?: boolean | undefined;
  /** The film's clock in seconds, for the live shimmer. */
  time?: number | undefined;
  /** Seconds since the row appeared. */
  age?: number | undefined;
  /** Output lines the card keeps in view. Default 5. */
  rows?: number | undefined;
}

/**
 * A tool call in the transcript (`activity-row`, `tool-card.css`): a 32 pt row with the tool's 14 pt
 * mark, its name and what it acts on, shimmering while it runs. Its output streams into the tool
 * card under it, which then folds away and leaves the one-line row with its summary.
 */
export function ToolCard({
  icon: Icon,
  title,
  detail,
  label,
  lines = [],
  stream = 1,
  collapse = 0,
  summary,
  done = false,
  time = 0,
  age,
  rows = 5,
}: ToolCardProps) {
  if (!present(age)) return null;
  const arrived = lines.length * clamp01(stream);
  const count = Math.ceil(arrived);
  const visible = lines.slice(Math.max(0, count - rows), count);
  const first = Math.max(0, count - rows);
  const fold = clamp01(collapse);
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age) }}>
      <div>
        <div className="pk-row">
          <Icon className="pk-icon pk-row__icon" strokeWidth={1.75} />
          <span
            className={done ? 'pk-row__meta' : 'pk-row__meta pk-shimmer'}
            style={done ? undefined : { '--shimmer': shimmerAt(time) }}
          >
            {detail ? `${title} ${detail}` : title}
          </span>
          {done && summary && <span className="pk-row__trail">{summary}</span>}
        </div>
        {lines.length > 0 && fold < 1 && (
          <div className="pk-row-body" style={{ '--fold': fold }}>
            <div className="pk-card">
              {label && (
                <div className="pk-card__header">
                  <Icon className="pk-icon" />
                  <span className="pk-card__label">{label}</span>
                </div>
              )}
              <div className="pk-card__content">
                <pre className="pk-output">
                  {visible.map((line, index) => {
                    const at = first + index;
                    return (
                      <span key={at} className="pk-unit" style={{ '--a': clamp01(arrived - at) }}>
                        {line || ' '}
                      </span>
                    );
                  })}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
