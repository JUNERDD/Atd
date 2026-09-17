import { createContext, use } from 'react';
import type { ContextBubbleContextValue } from '../_types/context';

export const ContextBubbleContext = createContext<ContextBubbleContextValue | null>(null);

/**
 * Reads the nearest ContextBubble state contract. Throws outside Root so a
 * misplaced part fails loudly instead of rendering silently disconnected UI.
 */
export function useContextBubble(): ContextBubbleContextValue {
  const context = use(ContextBubbleContext);
  if (!context) {
    throw new Error('ContextBubble.* must be used within <ContextBubble.Root>');
  }
  return context;
}
