import { Fragment } from 'react';
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Focus,
  Grid3x3,
  GripVertical,
  Highlighter,
  ListOrdered,
  MousePointer2,
  Pencil,
  Redo2,
  Slash,
  Square,
  Type,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01, easeOut } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { strings } from './strings.ts';
import './tokens.css';
import './native.css';

/** The tools in the toolbar's order, with the Lucide glyphs the shell ships (`AnnotationIcons`). */
const TOOLS = [
  ['select', MousePointer2],
  ['rectangle', Square],
  ['ellipse', Circle],
  ['arrow', ArrowUpRight],
  ['line', Slash],
  ['pen', Pencil],
  ['highlighter', Highlighter],
  ['text', Type],
  ['mosaic', Grid3x3],
  ['spotlight', Focus],
  ['step', ListOrdered],
] as const satisfies readonly (readonly [string, LucideIcon])[];

export type AnnotationTool = (typeof TOOLS)[number][0];
export type AnnotationColor = 'red' | 'yellow' | 'green' | 'blue' | 'black' | 'white';
const COLORS: readonly AnnotationColor[] = ['red', 'yellow', 'green', 'blue', 'black', 'white'];

export type AnnotationAction = 'undo' | 'redo' | 'cancel' | 'copy' | 'done';

export interface AnnotationToolbarProps {
  lang: Lang;
  /** The active tool (accent fill); none before the first choice. */
  tool?: AnnotationTool | undefined;
  /**
   * The style bar under the toolbar, for what the active tool draws: colours (the chosen one
   * ringed) and the size slider. Default: shown while a tool other than Select is active.
   */
  styleBar?: boolean | undefined;
  color?: AnnotationColor | undefined;
  /** The size slider's place, 0 → 1 (default 0.3, the shell's default stroke). */
  size?: number | undefined;
  /** Undo is enabled once something is drawn. */
  canUndo?: boolean | undefined;
  /** An action under the pointer, or held down. */
  hover?: AnnotationAction | undefined;
  pressed?: AnnotationAction | undefined;
  /** Seconds since the bars appeared: they pop in on the `pop` spring. */
  entrance?: number | undefined;
}

/**
 * The capture's annotation bars (`AnnotationToolbar`, `AnnotationStyleBar`): a 40 pt glass capsule
 * of the grip and the eleven tools, undo and redo, then cancel, copy and Done (the check, in the
 * accent colour); under it, the style bar. Its box's top-right corner is the bars' anchor.
 */
export function AnnotationToolbar({
  lang,
  tool,
  styleBar,
  color = 'red',
  size = 0.3,
  canUndo = false,
  hover,
  pressed,
  entrance,
}: AnnotationToolbarProps) {
  const t = strings[lang].capture;
  const showStyle = styleBar ?? (tool !== undefined && tool !== 'select');
  const grow = entrance === undefined ? 1 : springAt(entrance, 0, springs.pop);
  const fade = entrance === undefined ? 1 : easeOut(clamp01(entrance / 0.2));
  const wash = (action: AnnotationAction) =>
    pressed === action ? 'pressed' : hover === action ? 'hover' : undefined;
  const actions: readonly (readonly [AnnotationAction, LucideIcon, string])[] = [
    ['undo', Undo2, t.undo],
    ['redo', Redo2, t.redo],
    ['cancel', X, t.cancel],
    ['copy', Copy, t.copy],
    ['done', Check, t.done],
  ];
  return (
    <div
      className="pk-bars"
      style={{ '--grow': grow, '--fade': entrance !== undefined && entrance < 0 ? 0 : fade }}
    >
      <div className="glass pk-bar" data-glass="capsule">
        <span className="pk-capsule__grip">
          <GripVertical className="pk-icon" />
        </span>
        {TOOLS.map(([name, Icon]) => (
          <span key={name} className="pk-native-button" data-selected={tool === name || undefined}>
            <Icon className="pk-icon" />
          </span>
        ))}
        {actions.map(([action, Icon, label], index) => (
          <Fragment key={action}>
            {(index === 0 || index === 2) && <i className="pk-bar__divider" />}
            <span
              className="pk-native-button"
              aria-label={label}
              data-wash={wash(action)}
              data-disabled={(action === 'undo' && !canUndo) || action === 'redo' || undefined}
              data-tint={action === 'done' ? 'accent' : undefined}
            >
              <Icon className="pk-icon" />
            </span>
          </Fragment>
        ))}
      </div>
      {showStyle && (
        <div className="glass pk-bar" data-glass="capsule">
          {COLORS.map((swatch) => (
            <span
              key={swatch}
              className="pk-native-button"
              data-ring={color === swatch || undefined}
            >
              <i className="pk-swatch" data-color={swatch} />
            </span>
          ))}
          <i className="pk-bar__divider" />
          <span className="pk-size" style={{ '--size': clamp01(size) }}>
            <i />
          </span>
        </div>
      )}
    </div>
  );
}
