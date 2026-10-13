import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../copy.ts';
import { useFontsReady } from '../fonts.ts';
import {
  BAR,
  beatIndex,
  RELEASE_SECTIONS,
  releaseSectionLength,
  type ReleaseSectionId,
} from './timeline.ts';
import { Caret } from './world/Caret.tsx';
import { DotField } from './world/DotField.tsx';
import { Statement } from './world/Statement.tsx';
import type { Pulse } from './world/dots.ts';
import './scene-placeholder.css';

interface ScenePlaceholderProps {
  lang: Lang;
  id: ReleaseSectionId;
  /** The section's narrative line, in the cut's language. */
  line: string;
}

/**
 * A section not yet built, shown on the world's backdrop so the film plays end to end: its id and
 * bars, its narrative line rising in, a pulse on every downbeat, and the caret keeping the beat.
 */
export function ScenePlaceholder({ lang, id, line }: ScenePlaceholderProps) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const section = RELEASE_SECTIONS[id];
  const length = releaseSectionLength(id);
  const pulses: Pulse[] = [];
  for (let at = 0; at < length; at += BAR) pulses.push({ x: 960, y: 560, at, strength: 0.8 });
  const beat = beatIndex(t);
  return (
    <AbsoluteFill className="scene r08">
      <DotField t={t} pulses={pulses} />
      <div className="r08-placeholder__meta">
        <span className="r08-placeholder__id">{id}</span>
        <span>
          bars {section.bars[0]}–{section.bars[1]} · bar {section.bars[0] + Math.floor(beat / 4)},
          beat {(beat % 4) + 1}
        </span>
      </div>
      <div className="r08-placeholder__line">
        <Statement t={t} lang={lang} text={line} at={0.3} out={length - 0.5} />
      </div>
      <Caret t={t} x={952} y={760} height={64} />
    </AbsoluteFill>
  );
}
