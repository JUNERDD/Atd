import { POPUP_SEARCH } from '../messages/ports.ts';

/**
 * Where this page shows. `sidePanel`: Chrome's side panel, beside one window's tabs, open until the
 * person closes it. `popup`: the toolbar popup, where a browser has no side panel
 * (`background/action-surface.ts`), which closes once the person goes elsewhere and is dismissed
 * by its own choices.
 */
export type Surface = 'sidePanel' | 'popup';

export const SURFACE: Surface = location.search === POPUP_SEARCH ? 'popup' : 'sidePanel';
