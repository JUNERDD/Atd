import { useMemo, useRef } from 'react';
import { useDemoSequence } from './use-demo-sequence';
import './demos.css';

/** From the composer's arrival to the first key, in ms. */
const START_MS = 420;
/** Between two typed characters; a space takes a little longer, as it does when people type. */
const KEY_MS = 55;
const SPACE_MS = 110;
/** Picking an entry from the menu that `@` or `/` opens, before its chip lands. */
const CHIP_MS = 280;
/** The first key after a chip. */
const AFTER_CHIP_MS = 200;

/** One keystroke of the line: a character of the text, or a chip landing. */
type Key = { kind: 'char'; char: string } | { kind: 'chip' };

function keysOf(lead: string, join: string): Key[] {
  const chars = (text: string) => Array.from(text, (char): Key => ({ kind: 'char', char }));
  return [...chars(lead), { kind: 'chip' }, ...chars(join), { kind: 'chip' }];
}

/** The wait before each key: the demo sequence's delays. */
function delaysOf(keys: readonly Key[]): number[] {
  return keys.map((key, index) => {
    if (index === 0) return START_MS;
    if (key.kind === 'chip') return CHIP_MS;
    if (keys[index - 1]?.kind === 'chip') return AFTER_CHIP_MS;
    return key.char === ' ' ? SPACE_MS : KEY_MS;
  });
}

type CaretAt = 'lead' | 'join' | 'end';

interface ComposerTextProps {
  lead: string;
  /** The file chip's name, once it has landed. */
  file: string | null;
  join: string;
  /** The command chip's name, once it has landed. */
  command: string | null;
  caret: CaretAt;
  /** The invisible copy of the finished line that holds the composer's final size. */
  sizer?: boolean;
}

function Chip({ mark, name }: { mark: string; name: string }) {
  return (
    <span className="feat__chip">
      <span className="feat__chip-key">{mark}</span>
      {name}
    </span>
  );
}

/** The line as far as it is typed, with the caret where typing is. */
function ComposerText({ lead, file, join, command, caret, sizer = false }: ComposerTextProps) {
  return (
    <span className="feat__composer-text" data-sizer={sizer ? '' : undefined}>
      <span className="feat__words">
        {lead}
        {caret === 'lead' ? <span className="feat__caret" /> : null}
      </span>
      {file === null ? null : <Chip mark="@" name={file} />}
      <span className="feat__words">
        {join}
        {caret === 'join' ? <span className="feat__caret" /> : null}
      </span>
      {/* The last chip and the caret wrap as one, so the caret never starts a line on its own. */}
      <span className="feat__chip-end">
        {command === null ? null : <Chip mark="/" name={command} />}
        {caret === 'end' ? <span className="feat__caret" /> : null}
      </span>
    </span>
  );
}

interface ComposerLineProps {
  lead: string;
  file: string;
  join: string;
  command: string;
}

/**
 * A composer line with a file chip and a command chip, as `@` and `/` insert them. When it arrives it
 * types itself: the lead, then the file chip pops in, the joining words, the command chip, and the
 * caret settles into a blink while the line is on screen. The finished line is laid out invisibly in
 * the same cell, so the composer never changes size while it types.
 */
export function ComposerLine({ lead, file, join, command }: ComposerLineProps) {
  const ref = useRef<HTMLParagraphElement>(null);
  const keys = useMemo(() => keysOf(lead, join), [lead, join]);
  const delays = useMemo(() => delaysOf(keys), [keys]);
  const { step, live } = useDemoSequence(ref, delays);

  const leadLength = Array.from(lead).length;
  const joinLength = Array.from(join).length;
  const fileLanded = step > leadLength;
  const commandLanded = step === keys.length;
  const caret: CaretAt = commandLanded ? 'end' : fileLanded ? 'join' : 'lead';
  const typing = step > 0 && step < keys.length;

  return (
    <p
      ref={ref}
      className="feat__composer"
      aria-hidden="true"
      data-reveal-group=""
      data-live={live ? '' : undefined}
      data-idle={typing ? undefined : ''}
    >
      <ComposerText lead={lead} file={file} join={join} command={command} caret="end" sizer />
      <ComposerText
        lead={Array.from(lead).slice(0, step).join('')}
        file={fileLanded ? file : null}
        join={Array.from(join)
          .slice(0, Math.min(joinLength, Math.max(0, step - leadLength - 1)))
          .join('')}
        command={commandLanded ? command : null}
        caret={caret}
      />
    </p>
  );
}
