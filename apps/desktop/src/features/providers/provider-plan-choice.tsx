import { useId, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { planName, type ProviderService } from './provider-services';

/** Native radios preserve exclusive selection and arrow keys inside the compact control. */
export function ProviderPlanChoice({
  service,
  selected,
  focusSelected,
  onSelect,
}: {
  service: ProviderService;
  selected: string | null;
  focusSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation('providers');
  const group = useId();
  const selectedRadio = useRef<HTMLInputElement>(null);
  const plan = service.plans.find((item) => item.id === selected);
  useLayoutEffect(() => {
    if (focusSelected) selectedRadio.current?.focus();
  }, [focusSelected, selected]);
  return (
    <fieldset className="provider-plan-choice">
      <legend className="sr-only">{t('plans.title')}</legend>
      <div className="provider-plan-options">
        {service.plans.map((item) => (
          <Button asChild key={item.id} variant="ghost" className="provider-plan-option">
            <label>
              <input
                className="sr-only"
                ref={selected === item.id ? selectedRadio : undefined}
                type="radio"
                name={group}
                value={item.id}
                checked={selected === item.id}
                aria-describedby={
                  selected === item.id && item.definition ? `${group}-hint` : undefined
                }
                onChange={() => onSelect(item.id)}
              />
              {planName(item, t)}
            </label>
          </Button>
        ))}
      </div>
      {plan?.definition && (
        <p id={`${group}-hint`} className="settings-field-note provider-plan-hint">
          {t(plan.definition.descriptionKey)}
        </p>
      )}
    </fieldset>
  );
}
