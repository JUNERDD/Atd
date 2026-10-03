import { useState } from 'react';
import { CircleAlert, ShieldCheck, ShieldEllipsis } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from '@atd/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { morphIn } from './step-motion';

/** The row's words: what the permission is for, and the failure to open System Settings. */
export interface PermissionCopy {
  title: string;
  description: string;
  /** The title once the permission is held. */
  granted: string;
  /** The button that opens the permission's pane in System Settings. */
  open: string;
  error: string;
}

/**
 * A macOS permission, explained in one sentence with the one way to System Settings, where macOS
 * asks. The row follows the shell's live report (`trusted`): once held it turns into the granted
 * state and its shield morphs. The guide never asks or answers for the system itself; `request`
 * is the bridge call that shows the system prompt and opens the pane.
 */
export function PermissionRow({
  trusted,
  request,
  copy,
}: {
  trusted: boolean;
  request: () => Promise<void>;
  copy: PermissionCopy;
}) {
  const reduced = useReducedMotion() ?? false;
  const [error, setError] = useState(false);
  async function open() {
    setError(false);
    try {
      await request();
    } catch {
      setError(true);
    }
  }
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemMedia variant="icon" className="guide-row-icon" data-done={trusted || undefined}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={trusted ? 'granted' : 'needed'} {...morphIn(reduced)}>
              {trusted ? <ShieldCheck aria-hidden="true" /> : <ShieldEllipsis aria-hidden="true" />}
            </motion.span>
          </AnimatePresence>
        </ItemMedia>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="whitespace-normal">{trusted ? copy.granted : copy.title}</ItemTitle>
          {!trusted && (
            <ItemDescription className="whitespace-normal">{copy.description}</ItemDescription>
          )}
        </ItemContent>
        {!trusted && (
          <ItemActions className="ml-auto">
            <Button type="button" variant="outline" size="sm" onClick={() => void open()}>
              {copy.open}
            </Button>
          </ItemActions>
        )}
        {error && !trusted && (
          <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
            <CircleAlert aria-hidden="true" />
            <span>{copy.error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}
