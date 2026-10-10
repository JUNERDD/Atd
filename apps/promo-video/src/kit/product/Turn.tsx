import type { ReactNode } from 'react';
import './tokens.css';
import './turn.css';

/**
 * An assistant turn (`.transcript-turn`): its parts 12 pt apart, where the panel puts 20 pt between
 * turns. Put a reply's rows, cards and text in one.
 */
export function Turn({ children }: { children: ReactNode }) {
  return <div className="pk-turn">{children}</div>;
}
