import { useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import { createTextEffects } from '../../motion/text-effects';

/** The line starts typing once its step's title has brightened. */
const TYPE_DELAY = 120;

export interface CaseStep {
  id: string;
  /** The step's group, named above its first step. */
  group: string;
  groupStart: boolean;
  title: string;
  description: string;
  /** The step's clip, shown above its title where the steps stack without the stage beside them. */
  media: ReactNode;
}

interface CaseStepsProps {
  /** Names the list for assistive technology. */
  label: string;
  steps: readonly CaseStep[];
  active: number;
  /** The showcase has come into view (use-case-timeline.ts): the current step's line types in. */
  playing: boolean;
  /** The list's frame, which the timeline measures (use-case-timeline.ts). */
  frame: Ref<HTMLDivElement>;
  onSelect: (index: number) => void;
}

const number = (index: number) => String(index + 1).padStart(2, '0');

/**
 * A step's line. Where it shows only while its step is current (cases.css sets
 * `--case-desc-types` there), it types in behind a caret each time the step becomes current once
 * the showcase is in view (motion/text-effects.ts), unless the visitor asked for reduced motion. The typed copy is drawn
 * over the whole line, which holds the paragraph's shape so typing never reflows the steps the
 * timeline measures, and which assistive technology reads once instead of every typed frame.
 */
function CaseDescription({ text, typing }: { text: string; typing: boolean }) {
  const typed = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = typed.current;
    if (!typing || !element) return;
    if (getComputedStyle(element).getPropertyValue('--case-desc-types').trim() !== '1') return;
    const motion =
      document.documentElement.hasAttribute('data-motion') &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!motion) return;
    const effects = createTextEffects();
    effects.play(element, 'type', TYPE_DELAY);
    return () => effects.stop();
  }, [text, typing]);
  return (
    <p className="cases__desc">
      <span className="cases__desc-line">{text}</span>
      <span ref={typed} className="cases__desc-typed" aria-hidden="true">
        {text}
      </span>
    </p>
  );
}

/**
 * The showcase's scenes as a numbered index of steps along an LED rail. Each step's light sits on
 * the rail beside its title; the rail is lit down to the reading line (`--rail-fill`), and the
 * current step's light is on and its line shows (cases.css). Each title goes to its step, and each
 * step's id is the hash of its own link (`#automations`).
 */
export function CaseSteps({ label, steps, active, playing, frame, onSelect }: CaseStepsProps) {
  return (
    <div ref={frame} className="cases__index">
      <span className="cases__rail" data-case-rail="" aria-hidden="true">
        <span className="cases__rail-lit" />
      </span>
      <ol className="cases__steps" aria-label={label}>
        {steps.map((step, index) => (
          <li
            key={step.id}
            id={step.id}
            className="cases__step"
            data-case-step=""
            data-group-start={step.groupStart ? '' : undefined}
            data-current={index === active ? '' : undefined}
            data-passed={index < active ? '' : undefined}
            aria-current={index === active ? 'step' : undefined}
          >
            {step.groupStart ? <p className="cases__group legend">{step.group}</p> : null}
            <div className="cases__media">{step.media}</div>
            <h3 className="cases__step-title">
              <button
                type="button"
                className="cases__step-button"
                aria-controls="case-screen"
                onClick={() => onSelect(index)}
              >
                <span className="cases__node" data-case-node="" aria-hidden="true" />
                <span className="cases__number readout" aria-hidden="true">
                  {number(index)}
                </span>
                <span className="cases__name">{step.title}</span>
              </button>
            </h3>
            <CaseDescription text={step.description} typing={playing && index === active} />
          </li>
        ))}
      </ol>
    </div>
  );
}
