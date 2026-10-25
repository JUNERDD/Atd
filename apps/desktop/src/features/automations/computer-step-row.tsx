import { createElement, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownUp,
  Globe,
  Hourglass,
  MousePointerClick,
  Send,
  TextCursorInput,
  type LucideIcon,
} from 'lucide-react';
import type { ComputerRecipeStep } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Input } from '@atd/ui/components/input';
import { Label } from '@atd/ui/components/label';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import { FieldError } from '../commands/field-error';
import { isSubmitStep, stepWords } from './computer-scope';

function stepIcon(step: ComputerRecipeStep): LucideIcon {
  switch (step.kind) {
    case 'navigate':
      return Globe;
    case 'fill':
    case 'setValue':
      return TextCursorInput;
    case 'press':
      return step.effect === 'submit' ? Send : MousePointerClick;
    case 'scroll':
      return ArrowDownUp;
    case 'wait':
      return Hourglass;
  }
}

/**
 * One approved step, read-only but for the longest text a fill may enter: its number and what it
 * does, the target it acts on, and Submits on a step that submits. A step whose target is not
 * picked says so, since the service refuses that scope. Further text constraints (a pattern, a
 * fixed list) read as written.
 */
export function ComputerStepRow({
  step,
  index,
  target,
  unpicked,
  maxLengthLimit,
  onMaxLength,
}: {
  step: ComputerRecipeStep;
  index: number;
  /** The target's label. */
  target: string;
  /** The step's target is not among the scope's targets. */
  unpicked: boolean;
  maxLengthLimit: number;
  onMaxLength: (maxLength: number) => void;
}) {
  const { t } = useTranslation('automations');
  const text = step.kind === 'fill' || step.kind === 'setValue' ? step.text : null;
  // The field keeps what is typed; only a whole number in range reaches the draft.
  const [typed, setTyped] = useState(text ? String(text.maxLength) : '');
  const constraints = [
    text?.pattern && t('computer.textPattern', { pattern: text.pattern }),
    text?.oneOf && t('computer.textOneOf', { values: text.oneOf.join(', ') }),
  ].filter(Boolean);
  const inputId = `automation-computer-step-${step.stepId}-length`;
  const typedValue = Number(typed);
  // A value outside the limit stays in the field, marked, until it is fixed; the draft keeps the
  // last valid one.
  const invalid =
    text !== null &&
    !(Number.isInteger(typedValue) && typedValue >= 1 && typedValue <= maxLengthLimit);
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li>
        <ItemMedia variant="icon">{createElement(stepIcon(step))}</ItemMedia>
        <ItemContent className="min-w-[min(160px,100%)]">
          <ItemTitle className="whitespace-normal">
            {t('computer.stepTitle', { number: index + 1, label: step.label })}
            {isSubmitStep(step) && <Badge variant="outline">{t('computer.submits')}</Badge>}
          </ItemTitle>
          <ItemDescription className="whitespace-normal">
            {[stepWords(step, t), target, ...constraints].join(' · ')}
          </ItemDescription>
          {unpicked && (
            <p className="settings-inline-error m-0">{t('computer.stepTargetUnpicked')}</p>
          )}
          {invalid && (
            <FieldError id={`${inputId}-error`}>
              {t('computer.maxLengthInvalid', { max: maxLengthLimit })}
            </FieldError>
          )}
        </ItemContent>
        {text && (
          <ItemActions className="ml-auto items-center gap-2">
            <Label htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
              {t('computer.maxLength')}
            </Label>
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={1}
              max={maxLengthLimit}
              className="w-24"
              value={typed}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? `${inputId}-error` : undefined}
              onChange={(event) => {
                setTyped(event.target.value);
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 1 && value <= maxLengthLimit)
                  onMaxLength(value);
              }}
            />
          </ItemActions>
        )}
      </li>
    </Item>
  );
}
