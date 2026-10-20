import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AddonErrorCode } from '@atd/agent-contracts';
import { Alert, AlertDescription, AlertTitle } from '@atd/ui/components/alert';

/** Codes whose summary says everything; the others add the service's own English detail. */
const SELF_EXPLAINING: readonly AddonErrorCode[] = ['inUse', 'unavailable'];

/**
 * An install or removal that failed, in place under the add-on. The summary is translated from
 * the error's code; the service's message follows for the codes a person cannot act on from the
 * summary alone. Trying again is the row's own Install or Update, so the notice has no action.
 */
export function AddonFailureNotice({
  code,
  message,
}: {
  code: AddonErrorCode | 'request';
  message: string;
}) {
  const { t } = useTranslation('addons');
  const detail = code === 'request' || !SELF_EXPLAINING.includes(code) ? message : null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{t(`error.${code}`)}</AlertTitle>
      {detail ? <AlertDescription className="break-words">{detail}</AlertDescription> : null}
    </Alert>
  );
}
