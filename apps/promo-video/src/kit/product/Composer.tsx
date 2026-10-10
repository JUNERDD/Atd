import type { ReactNode } from 'react';
import { ArrowUp, ChevronDown, Plus, Shield, ShieldAlert, ShieldCheck, Square } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { clamp01 } from '../../motion/ease.ts';
import { Chip, type ChipProps } from './Chip.tsx';
import { strings } from './strings.ts';
import { typed } from './text.ts';
import './tokens.css';
import './composer.css';

export type PermissionTier = 'manual' | 'auto' | 'always';

const TIER_ICONS = { manual: ShieldAlert, auto: Shield, always: ShieldCheck } as const;

export interface ModelPill {
  /** The model's display name, untranslated (`Claude Sonnet 4.5`). */
  name: string;
  /** Its context window as the app abbreviates it (`200K`). */
  context?: string | undefined;
  effort?: 'low' | 'medium' | 'high' | undefined;
  /** A provider mark's URL (an imported SVG), drawn as a 12 pt `currentColor` mask. */
  brand?: string | undefined;
}

export interface ComposerProps {
  lang: Lang;
  /** The draft. Empty (the default) shows the placeholder. */
  text?: string | undefined;
  /** How much of `text` is typed, 0 → 1, revealed by grapheme. Default 1. */
  typing?: number | undefined;
  /**
   * The film's clock in seconds, which shows the caret at the end of the draft: solid while
   * typing, then blinking every 1.06 s. Omit for an unfocused field.
   */
  caret?: number | undefined;
  /** Chips at the start of the draft (a quote, a screenshot, files), each with its own `age`. */
  chips?: readonly ChipProps[] | undefined;
  /** The field grown to two rows (the draft above, the buttons below), as a longer draft does. */
  expanded?: boolean | undefined;
  /** The follow-up placeholder ("Ask a follow-up…") of a conversation. */
  followUp?: boolean | undefined;
  tier?: PermissionTier | undefined;
  model?: ModelPill | undefined;
  /** A run is going: Send turns into Stop. */
  running?: boolean | undefined;
  /** The send button held down, 0 → 1 (it dims and gives a little). */
  press?: number | undefined;
  /** The `ProgressPill`, centered 8 pt above the field. */
  pill?: ReactNode;
}

/**
 * The composer (`components/composer.tsx`): the glass field with Attach on its leading edge and
 * Send on its trailing one, chips inline in the draft, and under it the run configuration: the
 * permission tier on the left and the model pill on the right.
 */
export function Composer({
  lang,
  text = '',
  typing = 1,
  caret,
  chips = [],
  expanded = false,
  followUp = false,
  tier = 'manual',
  model,
  running = false,
  press = 0,
  pill,
}: ComposerProps) {
  const t = strings[lang];
  const draft = typed(text, typing);
  const empty = draft.length === 0 && chips.length === 0;
  const TierIcon = TIER_ICONS[tier];
  const blinkOn = caret !== undefined && (typing < 1 || caret % 1.06 < 0.53);
  const pressed = clamp01(press);
  return (
    <div className="pk-composer" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      {pill && <div className="pk-composer__pill">{pill}</div>}
      <div className="pk-composer__field" data-expanded={expanded || undefined}>
        <div className="pk-composer__prompt">
          <div className="pk-composer__line">
            {chips.map((chip, index) => (
              <Chip key={index} {...chip} />
            ))}
            {empty ? (
              <span className="pk-composer__placeholder">
                {followUp ? t.composer.followUp : t.composer.placeholder}
              </span>
            ) : (
              <span className="pk-composer__text">{draft}</span>
            )}
            {caret !== undefined && (
              <span className="pk-composer__caret" data-on={blinkOn || undefined} />
            )}
          </div>
        </div>
        <span className="pk-composer__attach">
          <Plus className="pk-icon" />
        </span>
        <span
          className="pk-composer__send"
          data-ready={!empty || running || undefined}
          style={{ '--press': pressed }}
        >
          {running ? (
            <Square className="pk-icon pk-composer__stop" />
          ) : (
            <ArrowUp className="pk-icon" />
          )}
        </span>
      </div>
      <div className="pk-composer__config">
        <span className="pk-xs-button">
          <TierIcon className="pk-icon pk-composer__tier-icon" />
          <span>{t.tier[tier]}</span>
        </span>
        {model && (
          <span className="pk-xs-button pk-composer__model">
            {model.brand && (
              <span className="pk-composer__brand" style={{ '--brand': `url("${model.brand}")` }} />
            )}
            <span className="pk-composer__model-name">{model.name}</span>
            {model.context && <span className="pk-composer__meta">{model.context}</span>}
            {model.effort && <span className="pk-composer__meta">{t.effort[model.effort]}</span>}
            <ChevronDown className="pk-icon pk-composer__chevron" />
          </span>
        )}
      </div>
    </div>
  );
}
