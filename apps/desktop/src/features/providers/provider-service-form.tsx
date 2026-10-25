import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { Connection } from '../../client/providers/schema';
import { SettingsHeading } from '../settings/settings-heading';
import { SettingsUnsavedChangesContext } from '../settings/settings-unsaved-changes';
import { ProviderForm } from './provider-form';
import { ProviderPlanChoice } from './provider-plan-choice';
import {
  providerForPlan,
  providerPresentation,
  serviceName,
  type ProviderService,
} from './provider-services';

/** One configuration page: plan selection and the corresponding form share its route and scroll. */
export function ProviderServiceForm({
  service,
  connection,
  onSaved,
  onBack,
}: {
  service: ProviderService;
  connection: Connection | null;
  onSaved: (connection: Connection) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation('providers');
  const guard = useContext(SettingsUnsavedChangesContext);
  const [focusSelected, setFocusSelected] = useState(false);
  const [choice, setChoice] = useState<string | null>(() => service.plans[0]?.id ?? null);
  const stored = connection ? providerPresentation(connection) : null;
  const selected = connection
    ? stored && service.plans.some((plan) => plan.id === stored.plan.id)
      ? stored.plan.id
      : service.plans.find((plan) => plan.source.id === connection.provider)?.id
    : choice;
  const plan = service.plans.find((item) => item.id === selected);
  const title = serviceName(service, t);
  const choices =
    connection && stored ? (
      <div className="settings-field">
        <div className="settings-field-label">
          <span className="text-sm font-medium">{t('plans.title')}</span>
          <span>{t(stored.plan.nameKey)}</span>
        </div>
        {service.plans.length > 1 && <p className="settings-field-note">{t('plans.existing')}</p>}
      </div>
    ) : service.plans.length > 1 ? (
      <ProviderPlanChoice
        service={service}
        selected={selected ?? null}
        focusSelected={focusSelected}
        onSelect={(id) => {
          if (id === selected) return;
          const select = () => {
            setFocusSelected(true);
            setChoice(id);
          };
          if (guard) guard.confirmLeave(guard.depth() - 1, select);
          else select();
        }}
      />
    ) : null;
  if (plan)
    return (
      <ProviderForm
        key={plan.id}
        provider={providerForPlan(plan, t)}
        connection={connection}
        serviceName={title}
        presetId={plan.definition?.id}
        planChoice={choices}
        onSaved={onSaved}
        onBack={onBack}
      />
    );
  return (
    <section className="provider-form settings-editor" aria-label={t('form.sectionLabel')}>
      <SettingsHeading
        title={t('form.connect', { name: title })}
        subpage
        backLabel={t('form.back')}
      />
      <ScrollArea className="settings-page-scroll" gutter="none" scrollShadow>
        <div className="settings-editor-inner settings-fields">{choices}</div>
      </ScrollArea>
      <footer className="editor-footer">
        <div>
          <Button variant="glass" onClick={onBack}>
            {t('form.cancel')}
          </Button>
        </div>
      </footer>
    </section>
  );
}
