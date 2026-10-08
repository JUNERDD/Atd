import type { RefObject } from 'react';
import { DotGlyph } from '../../ui/dot-glyph';
import type { KeptId, ModelMode } from './copy';
import { glyphs } from './glyphs';
import './board.css';

interface Line {
  name: string;
  detail: string;
}

interface PrivacyBoardProps {
  ref: RefObject<HTMLDivElement | null>;
  mode: ModelMode;
  /** On screen: the task's packet travels across the edge; off screen it pauses. */
  live: boolean;
  zones: { mac: string; out: string };
  kept: Record<Exclude<KeptId, 'model'>, Line>;
  model: Line;
  out: Line;
}

const KEPT: readonly Exclude<KeptId, 'model'>[] = ['history', 'memory', 'setup', 'keys'];

/**
 * One display split at the edge of the Mac. On its side, everything Atd keeps, each a lit line;
 * the model's line is dim while the model runs at a provider and lights once it runs here. Across
 * the edge, what leaves: with a cloud model the task, carried over by a lit packet; with a local
 * model nothing, and the far side goes dark. The board is real text, and the far side announces
 * its change politely, so it needs no separate description.
 */
export function PrivacyBoard({ ref, mode, live, zones, kept, model, out }: PrivacyBoardProps) {
  return (
    <div
      ref={ref}
      className="privacy__board display"
      data-mode={mode}
      data-live={live ? '' : undefined}
      data-reveal="power"
    >
      <section className="privacy__zone" data-zone="mac" aria-label={zones.mac}>
        <p className="privacy__zone-title legend" aria-hidden="true">
          <span className="led" />
          {zones.mac}
        </p>
        <ul className="privacy__lines" data-reveal-group="" data-reveal-stagger="90">
          {KEPT.map((id) => (
            <BoardLine key={id} id={id} line={kept[id]} reveal />
          ))}
          <BoardLine id="model" line={model} dim={mode === 'cloud'} reveal />
        </ul>
      </section>
      <div className="privacy__edge" aria-hidden="true">
        <span className="privacy__packet" />
      </div>
      <section className="privacy__zone" data-zone="out" aria-label={zones.out}>
        <p className="privacy__zone-title legend" aria-hidden="true">
          <span className="led" />
          {zones.out}
        </p>
        <div className="privacy__out" aria-live="polite">
          {mode === 'cloud' ? (
            <ul className="privacy__lines" key="cloud">
              <BoardLine id="task" line={out} />
            </ul>
          ) : (
            <p className="privacy__nothing" key="local">
              <span className="privacy__nothing-title dot-text">{out.name}</span>
              <span className="legend">{out.detail}</span>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

interface BoardLineProps {
  id: keyof typeof glyphs;
  line: Line;
  dim?: boolean;
  /**
   * Fades in with the board's entrance. Only for lines present from the first render: the reveal
   * controller registers items once, so a line mounted later would stay hidden.
   */
  reveal?: boolean;
}

function BoardLine({ id, line, dim = false, reveal = false }: BoardLineProps) {
  return (
    <li
      className="privacy__line"
      data-line={id}
      data-dim={dim ? '' : undefined}
      data-reveal={reveal ? 'fade' : undefined}
    >
      <span className="privacy__glyph">
        <DotGlyph rows={glyphs[id]} />
      </span>
      <span className="privacy__name">{line.name}</span>
      <span className="privacy__detail legend">{line.detail}</span>
    </li>
  );
}
