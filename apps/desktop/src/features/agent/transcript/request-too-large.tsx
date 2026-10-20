import { useTranslation } from 'react-i18next';

/**
 * A model request the provider refused as too large even after the service dropped older images
 * and retried it (agent-service `harness/image-budget.ts`). It says what happened and what helps
 * in the user's language, with the provider's own text under the details.
 */
export function RequestTooLargeError({ error }: { error: string }) {
  const { t } = useTranslation('tasks');
  return (
    <div className="flex flex-col items-start gap-2">
      <p>{t('requestTooLarge.message')}</p>
      <details className="text-xs">
        <summary className="cursor-pointer">{t('requestTooLarge.details')}</summary>
        <p className="mt-2 wrap-anywhere whitespace-pre-wrap">{error}</p>
      </details>
    </div>
  );
}
