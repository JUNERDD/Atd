import type { ReactNode } from 'react';
import './tokens.css';
import './turn.css';

/**
 * Consecutive activity rows (`.activity-group`): thinking rows and tool calls 4 pt apart, so a run
 * of steps reads as one block inside its turn.
 */
export function ActivityGroup({ children }: { children: ReactNode }) {
  return <div className="pk-activity-group">{children}</div>;
}
