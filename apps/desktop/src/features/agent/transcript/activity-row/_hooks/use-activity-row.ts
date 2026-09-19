import { createContext, use } from 'react';
import type { ActivityRowContextValue } from '../_types/context';

export const ActivityRowContext = createContext<ActivityRowContextValue | null>(null);

/**
 * Reads the nearest ActivityRow state contract. Throws outside Root so a
 * misplaced part fails loudly instead of rendering silently disconnected UI.
 */
export function useActivityRow(): ActivityRowContextValue {
  const context = use(ActivityRowContext);
  if (!context) {
    throw new Error('ActivityRow.* must be used within <ActivityRow.Root>');
  }
  return context;
}
