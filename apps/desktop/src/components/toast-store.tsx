import { toast } from 'react-hot-toast';
import { messageOf, toastTextOf } from '../lib/errors';
import { ToastCard, type ToastKind } from './toast';

/**
 * Shows a short global toast. Identical text replaces the previous toast instead of stacking, and
 * `toastTextOf` guarantees that over-long copy is shortened at this boundary.
 */
export function showToast({ kind, text, id }: { kind: ToastKind; text: string; id?: string }) {
  const short = toastTextOf(text);
  toast.custom((item) => <ToastCard item={item} kind={kind} text={short} />, { id: id ?? short });
}

/** Reports an operation failure as a short error toast. */
export function showErrorToast(error: unknown) {
  showToast({ kind: 'error', text: typeof error === 'string' ? error : messageOf(error) });
}
