import { toast } from 'react-hot-toast';
import { isDiagnosableError, messageOf, recordErrorBreadcrumb, toastTextOf } from '../lib/errors';
import { ToastCard, type ToastKind } from './toast';

/**
 * Shows a short global toast. Identical text replaces the previous toast instead of stacking, and
 * `toastTextOf` guarantees that over-long copy is shortened at this boundary.
 */
export function showToast({
  kind,
  text,
  id,
  diagnose = false,
}: {
  kind: ToastKind;
  text: string;
  id?: string;
  diagnose?: boolean;
}) {
  const short = toastTextOf(text);
  toast.custom((item) => <ToastCard item={item} kind={kind} text={short} diagnose={diagnose} />, {
    id: id ?? short,
  });
}

/** Reports an operation failure as a short error toast while capturing `<= 320` chars in breadcrumbs. */
export function showErrorToast(error: unknown, options: { recordBreadcrumb?: boolean } = {}) {
  if (options.recordBreadcrumb !== false) {
    recordErrorBreadcrumb('unhandled_error', error);
  }
  showToast({
    kind: 'error',
    text: typeof error === 'string' ? error : messageOf(error),
    diagnose: isDiagnosableError(error),
  });
}
