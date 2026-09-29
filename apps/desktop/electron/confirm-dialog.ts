import { dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';

/** A main-process confirmation. Copy is English-only, like the other main-process dialogs. */
export interface ConfirmRequest {
  /** Bold heading; also the window title where the platform shows one. */
  message: string;
  detail: string;
  buttons: readonly string[];
  defaultId: number;
  /** The response for Escape or a dismissed dialog. */
  cancelId: number;
}

/** Shows a confirmation and resolves the index of the chosen button. */
export type Confirm = (request: ConfirmRequest) => Promise<number>;

/**
 * Confirmations as sheets on `parent()` when it is showing, otherwise app-modal. `withDialog`
 * serializes them with the panel's other native dialogs, so only one is shown at a time and the
 * panel is not hidden or re-pinned beneath an open sheet.
 */
export function createConfirm(
  parent: () => BrowserWindow | null,
  withDialog: <T>(operation: () => Promise<T>) => Promise<T>,
): Confirm {
  return (request) =>
    withDialog(async () => {
      const options: MessageBoxOptions = {
        type: 'warning',
        title: request.message,
        message: request.message,
        detail: request.detail,
        buttons: [...request.buttons],
        defaultId: request.defaultId,
        cancelId: request.cancelId,
        noLink: true,
      };
      const window = parent();
      const { response } = await (window && !window.isDestroyed() && window.isVisible()
        ? dialog.showMessageBox(window, options)
        : dialog.showMessageBox(options));
      return response;
    });
}
