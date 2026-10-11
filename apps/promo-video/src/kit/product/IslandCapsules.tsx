import { Check, GripVertical, X } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { spokeOpacity, sweepAt } from './island.ts';
import { hintParts, type IslandContent } from './island-layout.ts';
import { strings } from './strings.ts';

/**
 * The island's capsule contents (`IslandCapsules.swift`, `IslandPieces.swift`): 13 pt medium
 * labels, 12 pt secondary hints with keycaps, round 28 pt controls, never glass on glass. Every
 * moving part (the spinner's wave, the shimmer's band, the meter) is a function of `t`.
 */

/** The 16 pt spinner: 8 spokes 2 pt wide from a 3.5 pt radius to the edge, a wave turning clockwise. */
export function Spinner({ t }: { t: number }) {
  return (
    <svg className="pk-spinner" viewBox="0 0 16 16" aria-hidden="true">
      {Array.from({ length: 8 }, (_, spoke) => (
        <rect
          key={spoke}
          x="7"
          y="0"
          width="2"
          height="4.5"
          rx="1"
          transform={`rotate(${spoke * 45} 8 8)`}
          style={{ '--o': spokeOpacity(spoke, t) }}
        />
      ))}
    </svg>
  );
}

/**
 * Running text: a band in the label colour sweeping the secondary-coloured name every 2 s, its
 * half-width 2 pt per UTF-16 unit, as the page counts them (`ShimmerSweep`).
 */
export function Shimmer({ text, t }: { text: string; t: number }) {
  return (
    <span
      className="pk-island__shimmer"
      style={{ '--phase': sweepAt(t), '--spread': text.length * 2 }}
    >
      {text}
    </span>
  );
}

/** One key as the page's `Kbd` draws it: 20 pt tall, 12 pt medium, on an 8% fill. */
export function IslandKeycap({ symbol }: { symbol: string }) {
  return <kbd className="pk-island__keycap">{symbol}</kbd>;
}

/** A hint with its keys where the language puts them (`Press [Esc] to cancel`). */
function Hint({ template, keys }: { template: string; keys: readonly string[] }) {
  const [before, after] = hintParts(template);
  return (
    <span className="pk-island__hint">
      {before ? <span>{before}</span> : null}
      {keys.map((key) => (
        <IslandKeycap key={key} symbol={key} />
      ))}
      {after ? <span>{after}</span> : null}
    </span>
  );
}

interface CapsuleProps {
  lang: Lang;
  content: Exclude<IslandContent, { kind: 'card' } | { kind: 'answer' }>;
  /** Seconds on the island's clock, and since this content arrived (the meter fills on it). */
  t: number;
  age: number;
}

/** A capsule's content: press, working, writing, written or copied. */
export function IslandCapsule({ lang, content, t, age }: CapsuleProps) {
  const s = strings[lang].command;
  switch (content.kind) {
    case 'press':
      return (
        <span className="pk-island__row" data-kind="press">
          <span className="pk-island__label">{content.command}</span>
          <span className="pk-island__meter" style={{ '--fill': clamp01(age / 0.3) }} />
          <span className="pk-island__secondary">{s.holdHint}</span>
        </span>
      );
    case 'working':
      return (
        <span className="pk-island__row" data-kind="working">
          <span className="pk-island__grip">
            <GripVertical className="pk-icon" />
          </span>
          <span className="pk-island__status">
            <span className="pk-island__name">
              <Spinner t={t} />
              <Shimmer text={content.command} t={t} />
            </span>
            {content.summary ? <span className="pk-island__chip">{content.summary}</span> : null}
            <Hint template={s.escapeHint} keys={['Esc']} />
          </span>
          <span className="pk-island__close">
            <X className="pk-icon" />
          </span>
        </span>
      );
    case 'writing':
    case 'done':
    case 'copied':
      return (
        <span className="pk-island__row" data-kind="status">
          {content.kind === 'writing' ? <Spinner t={t} /> : <Check className="pk-island__check" />}
          <span className="pk-island__label">{s[content.kind]}</span>
        </span>
      );
  }
}
