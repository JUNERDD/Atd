import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, RotateCcw } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from '@atd/ui/components/item';
import { Slider } from '@atd/ui/components/slider';
import { IconButton } from '../../components/icon-button';

/** What a row's control is, for returning focus to it once its reset button goes away. */
const CONTROL = '[role="slider"], [role="combobox"], input:checked';

/**
 * One row of the Panel background page, in a `.settings-card`: the title and a wrapping
 * description, the control at the trailing edge (below the text in a narrow column), and a failed
 * save under it like the other settings rows' notes. While the row's setting differs from its
 * default, a reset button leads the control, as on the shortcut rows, so the control keeps its
 * place; resetting moves focus to the control, since the button then goes away.
 */
export function PanelBackgroundRow({
  title,
  description,
  anchor,
  error,
  changed,
  disabled,
  onReset,
  children,
}: {
  title: string;
  description: string;
  /** The `data-settings-anchor` that settings search reveals. */
  anchor: string;
  error?: string | undefined;
  /** Whether the row's setting differs from its default, which shows the reset button. */
  changed: boolean;
  disabled: boolean;
  /** Puts the row's setting back to its default. */
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  const actions = useRef<HTMLDivElement>(null);
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={anchor}>
        {/* Wide enough that the control wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription className="whitespace-normal">{description}</ItemDescription>
        </ItemContent>
        <ItemActions ref={actions} className="ml-auto flex-wrap justify-end">
          {changed && (
            <IconButton
              label={t('panelBackground.reset')}
              aria-label={t('panelBackground.resetLabel', { label: title })}
              disabled={disabled}
              onClick={() => {
                onReset();
                // After the reset renders: the chosen tint swatch is a different radio by then.
                requestAnimationFrame(() =>
                  actions.current?.querySelector<HTMLElement>(CONTROL)?.focus(),
                );
              }}
            >
              <RotateCcw />
            </IconButton>
          )}
          {children}
        </ItemActions>
        {error && (
          <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}

/**
 * A slider with its value as text beside it, which the slider also announces. Every step reports
 * through `onChange`; the caller's save keeps only the latest (`usePanelBackground`).
 */
export function PanelBackgroundSlider({
  label,
  value,
  min,
  max,
  step,
  text,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="settings-panel-slider">
      <Slider
        aria-label={label}
        aria-valuetext={text}
        min={min}
        max={max}
        step={step}
        value={[value]}
        // A range the tone or variant closes (nothing left to choose) cannot move either.
        disabled={disabled || max <= min}
        onValueChange={([next]) => {
          if (next !== undefined && next !== value) onChange(next);
        }}
      />
      <span className="settings-panel-slider-value" aria-hidden="true">
        {text}
      </span>
    </div>
  );
}
