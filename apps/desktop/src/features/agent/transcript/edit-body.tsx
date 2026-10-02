import { FilePen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { DiffView, FileCard } from './file-card';
import { parsePatch, piDiffToPatch } from './pi-diff';
import { ToolCard } from './tool-card';
import { diffStats } from './tool-output';

/** Pi's edit diff marks skipped context with a line holding only padding and `...`. */
const PI_GAP_LINE = /^\s+\.\.\.$/;
/**
 * Pi's display diff embeds the line number after the sign (`+12 text`, ` 12 text`); the sign and
 * number read as a muted gutter so the changed text stands out. Other lines render verbatim.
 */
const PI_NUMBERED_LINE = /^([+\- ] *\d+ ?)(.*)$/;

function lineKind(line: string): 'add' | 'del' | 'gap' | undefined {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'add';
  if (line.startsWith('-') && !line.startsWith('---')) return 'del';
  if (line.startsWith('@@') || PI_GAP_LINE.test(line)) return 'gap';
  return undefined;
}

function DiffLine({ line }: { line: string }) {
  const match = PI_NUMBERED_LINE.exec(line);
  return (
    <div className="tool-code-diff-line" data-kind={lineKind(line)}>
      {match ? (
        <>
          <span className="tool-code-diff-gutter">{match[1]}</span>
          {match[2]}
        </>
      ) : (
        line || ' '
      )}
    </div>
  );
}

/**
 * The diff as Pi printed it, line by line with tinted changes: the rendering for a diff that
 * does not convert to a patch (another shape, or numbers that do not add up).
 */
function FallbackDiff({ diff }: { diff: string }) {
  return (
    <div className="tool-code-diff">
      {diff.split('\n').map((line, index) => (
        <DiffLine key={`${index}:${line.slice(0, 24)}`} line={line} />
      ))}
    </div>
  );
}

/** The header tally: `+a −r`, with the counts spelled out for assistive technology. */
function DiffTally({ added, removed }: { added: number; removed: number }) {
  const { t } = useTranslation('tasks');
  return (
    <>
      <span className="tool-code-added" aria-hidden="true">
        +{added}
      </span>
      <span className="tool-code-removed" aria-hidden="true">
        −{removed}
      </span>
      <span className="sr-only">{t('toolCode.diffSummary', { added, removed })}</span>
    </>
  );
}

/**
 * An `edit` call's diff: Pi's numbered display diff converted to a unified patch and rendered by
 * `@pierre/diffs` with the path's highlighting, removed lines numbered by the old file and the
 * rest by the new one. The header tallies the change; a closing note says when the service
 * shortened the diff to its bound. A diff that does not convert reads as Pi printed it.
 */
export function EditBody({
  block,
  diff,
  truncated,
}: {
  /** The call, for its target path (language) and status. */
  block: BlockOf<'tool'>;
  diff: string;
  truncated: boolean;
}) {
  const { t } = useTranslation('tasks');
  const path = typeof block.args.path === 'string' ? block.args.path : '';
  const fileDiff = useMemo(() => {
    const patch = piDiffToPatch(path, diff);
    return patch ? parsePatch(patch) : null;
  }, [path, diff]);
  const { added, removed } = diffStats(diff);
  const notes = [
    truncated && t('activity.truncatedNote'),
    block.status === 'interrupted' && t('activity.interruptedNote'),
  ].filter((note) => typeof note === 'string');
  return (
    <FileCard
      icon={<FilePen />}
      path={path}
      meta={added + removed > 0 && <DiffTally added={added} removed={removed} />}
      copyText={diff}
      code={fileDiff !== null}
      footer={
        notes.length > 0 && (
          <ToolCard.Footer>
            {notes.map((note) => (
              <span key={note} className="tool-code-note">
                {note}
              </span>
            ))}
          </ToolCard.Footer>
        )
      }
    >
      {fileDiff ? <DiffView fileDiff={fileDiff} /> : <FallbackDiff diff={diff} />}
    </FileCard>
  );
}
