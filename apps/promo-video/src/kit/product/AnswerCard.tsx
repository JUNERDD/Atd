import { X } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { ANSWER, answerCardLayout, type AnswerCardSpec } from './answer-card.ts';
import { CardFooter } from './OptionsCard.tsx';
import { strings } from './strings.ts';

interface AnswerCardProps {
  lang: Lang;
  card: AnswerCardSpec;
  /** How far the answer has scrolled, in points (a long answer only). Default 0. */
  scroll?: number | undefined;
  /** The button held down: `copy` or `open` (16% wash). */
  pressed?: 'copy' | 'open' | undefined;
}

/**
 * The answer card (`IslandAnswerCard.swift`): the command's name (12 pt semibold, secondary) with
 * a close button on the 28 pt title row, the note under it, the answer (13 pt, selectable in the
 * app) in the room between, fading out over 16 pt at an edge with more of it past it, and the
 * footer: ⌘C Copy and esc Close, then Open in Atd beside Copy on its 8% wash. Rendered inside
 * `CommandIsland` for an `answer` content; its size comes from `answerCardLayout`.
 */
export function AnswerCard({ lang, card, scroll = 0, pressed }: AnswerCardProps) {
  const t = strings[lang].command.answer;
  const layout = answerCardLayout(lang, card);
  const room = Math.min(layout.answer, layout.room);
  const offset = Math.min(Math.max(scroll, 0), Math.max(layout.answer - room, 0));
  return (
    <div className="pk-answer">
      <span className="pk-answer__header">
        <span className="pk-answer__title">{card.command}</span>
        <span className="pk-island__close">
          <X className="pk-icon" />
        </span>
      </span>
      {card.note ? <span className="pk-answer__note">{card.note}</span> : null}
      <span
        className="pk-answer__scroll"
        data-fade-top={offset > 0.5 || undefined}
        data-fade-bottom={offset < layout.answer - room - 0.5 || undefined}
        style={{ '--room': room, '--offset': offset, '--fade': ANSWER.fade }}
      >
        <span className="pk-answer__text">{card.answer}</span>
      </span>
      <CardFooter
        hints={[
          ['⌘C', t.copy],
          ['esc', t.close],
        ]}
      >
        <span className="pk-answer__buttons">
          <span className="pk-options__run" data-pressed={pressed === 'open' || undefined}>
            {t.openInAtd}
          </span>
          <span
            className="pk-options__run"
            data-rest=""
            data-pressed={pressed === 'copy' || undefined}
          >
            {t.copy}
          </span>
        </span>
      </CardFooter>
    </div>
  );
}
