import { toast } from 'react-hot-toast';
import { isDiagnosableError, messageOf, recordErrorBreadcrumb, toastTextOf } from '../lib/errors';
import { ToastCard, type ToastAction, type ToastKind } from './toast';

/**
 * Shows a short global toast. Identical text (and `detail`) replaces the previous toast instead of
 * stacking, and `toastTextOf` guarantees that over-long copy is shortened at this boundary.
 * `detail` names the file or folder the toast is about, under `text` as its title; the card
 * shortens it in the middle rather than here. `action` adds a button that fixes what the text
 * reports.
 */
export function showToast({
  kind,
  text,
  detail,
  id,
  diagnose = false,
  action,
}: {
  kind: ToastKind;
  text: string;
  detail?: string;
  id?: string;
  diagnose?: boolean;
  action?: ToastAction;
}) {
  const short = toastTextOf(text);
  toast.custom(
    (item) => (
      <ToastCard
        item={item}
        kind={kind}
        text={short}
        diagnose={diagnose}
        {...(detail ? { detail } : {})}
        {...(action ? { action } : {})}
      />
    ),
    { id: id ?? (detail ? `${short}\n${detail}` : short) },
  );
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
