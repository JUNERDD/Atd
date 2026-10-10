import type { ReactNode } from 'react';
import { springs } from '../../motion/spring.ts';
import { Chip, type ChipProps } from './Chip.tsx';
import { arrival, present } from './motion.ts';
import './tokens.css';
import './user-message.css';

export interface UserMessageProps {
  text: string;
  /** Chips sent with the text, at its start, as the composer had them (a quote, a screenshot). */
  chips?: readonly ChipProps[] | undefined;
  /** Attachments above the bubble, flush right: `FileChip`s (a file card or an image thumbnail). */
  attachments?: ReactNode;
  /** Seconds since it was sent: it rises into place. Omit when it is simply there. */
  age?: number | undefined;
}

/**
 * A sent message (`.user-message`, `.message-bubble` in agent.css): a bubble on the trailing edge,
 * at most 304 pt wide, with a 20 pt corner on the muted fill and 14/24 text; attachments sit above
 * it, flush with the same edge.
 */
export function UserMessage({ text, chips = [], attachments, age }: UserMessageProps) {
  if (!present(age)) return null;
  return (
    <div className="pk-arrive" style={{ '--in': arrival(age, springs.window) }}>
      <div className="pk-user">
        {attachments && <div className="pk-user__attachments">{attachments}</div>}
        <div className="pk-user__bubble">
          {chips.map((chip, index) => (
            <Chip key={index} {...chip} />
          ))}
          {text}
        </div>
      </div>
    </div>
  );
}
