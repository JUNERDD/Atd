import { Brain, Sparkle } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01, smoothstep } from '../../motion/ease.ts';
import { springs } from '../../motion/spring.ts';
import { arrival, present } from './motion.ts';
import { strings } from './strings.ts';
import './tokens.css';
import './memory-chip.css';

export interface MemoryChipProps {
  lang: Lang;
  /** What was remembered, as the memory's description reads (`prefers metric units`). */
  text: string;
  /** Seconds since it was saved: it pops in, a light sweeps it once and two sparkles twinkle. */
  age?: number | undefined;
}

/**
 * A memory saved from the conversation, as a quiet chip in the transcript: the Settings mark for
 * Memory (`Brain`), "Remembered:" and what it keeps. The film's own summary of the app's "Save
 * memory" step; the sparkles fade after a second.
 */
export function MemoryChip({ lang, text, age }: MemoryChipProps) {
  if (!present(age)) return null;
  const seconds = age ?? 10;
  const sweep = clamp01((seconds - 0.1) / 0.7);
  const twinkle = (delay: number) => {
    const local = seconds - delay;
    return smoothstep(0, 0.18, local) * (1 - smoothstep(0.5, 1.1, local));
  };
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age, springs.pop) }}>
      <div className="pk-memory-row">
        <span className="pk-memory" style={{ '--sweep': sweep }}>
          <Brain className="pk-icon pk-memory__icon" strokeWidth={1.75} />
          <span className="pk-memory__label">{strings[lang].memory.remembered}</span>
          <span className="pk-memory__text">{text}</span>
          <Sparkle
            className="pk-icon pk-memory__spark"
            data-at="a"
            style={{ '--t': twinkle(0.15) }}
          />
          <Sparkle
            className="pk-icon pk-memory__spark"
            data-at="b"
            style={{ '--t': twinkle(0.35) }}
          />
        </span>
      </div>
    </div>
  );
}
