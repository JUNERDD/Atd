import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CircleCheck, CircleDashed } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import '../settings/settings.css';
import { morphIn } from './step-motion';
import './steps.css';

/**
 * One step's left column, shared by every step: the leading-aligned title and description (the
 * settings page heading's type), the goal status where the step has a goal, then the step's
 * controls, which compose the settings cards and rows. `focusHeading` moves focus to the title as
 * the step appears, so keyboard and VoiceOver users start reading the new step; the guide's first
 * step keeps focus where the window put it. The art lives in the card's other column, so nothing
 * here is decorative.
 */
export function OnboardingStep({
  title,
  description,
  status,
  focusHeading,
  children,
}: {
  title: string;
  description: ReactNode;
  /** The step's goal status (`GoalStatus`), right under the description. */
  status?: ReactNode;
  focusHeading: boolean;
  children?: ReactNode;
}) {
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) heading.current?.focus({ preventScroll: true });
  }, [focusHeading]);
  return (
    <section className="guide-step" aria-labelledby={`${ids}-title`}>
      <header className="guide-step-text">
        <h1 id={`${ids}-title`} ref={heading} tabIndex={-1} className="guide-step-title">
          {title}
        </h1>
        <p className="guide-step-description">{description}</p>
      </header>
      {status}
      {children && <div className="guide-step-controls">{children}</div>}
    </section>
  );
}

/**
 * A goal's live status, one quiet row on a neutral surface: a dashed circle with what the step
 * waits for, then, once the app's real state meets the goal, a check (which morphs
 * in) with the result. Only the icon and the text change. It is an `output`, so screen readers
 * announce the change politely; the text always carries the state, the icon only echoes it.
 */
export function GoalStatus({
  met,
  waiting,
  success,
  detail,
}: {
  met: boolean;
  /** What the step waits for while the goal is unmet. */
  waiting: string;
  /** The result once met. */
  success: string;
  /** A second line under the result, such as the model a connection runs. */
  detail?: string | undefined;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <Item asChild variant="muted" size="sm">
      <output aria-live="polite">
        <ItemMedia variant="icon" className="guide-row-icon" data-done={met || undefined}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span key={met ? 'met' : 'waiting'} className="flex" {...morphIn(reduced)}>
              {met ? <CircleCheck aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}
            </motion.span>
          </AnimatePresence>
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="whitespace-normal">{met ? success : waiting}</ItemTitle>
          {met && detail && (
            <ItemDescription className="whitespace-normal">{detail}</ItemDescription>
          )}
        </ItemContent>
      </output>
    </Item>
  );
}

/** Stands in for the keys while the sentence is translated, then splits it around them. */
const KEYS_MARKER = '⁣';

/**
 * A translated sentence with a shortcut's keys set inline as keycaps, wherever the language puts
 * them: `sentence` receives a placeholder for the keys (pass it as the interpolation value). It
 * is phrasing content, so it can be a step's description or sit in a paragraph of its own.
 */
export function KeysSentence({
  sentence,
  keys,
}: {
  sentence: (keys: string) => string;
  keys: readonly string[];
}) {
  const [before = '', after = ''] = sentence(KEYS_MARKER).split(KEYS_MARKER);
  return (
    <span className="guide-instruction">
      {before}
      <KbdGroup className="guide-instruction-keys">
        {keys.map((key, index) => (
          <Kbd key={`${index}-${key}`}>{key}</Kbd>
        ))}
      </KbdGroup>
      {after}
    </span>
  );
}
