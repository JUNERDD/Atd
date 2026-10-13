import { createContext, use, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@atd/ui/components/context-menu';
import { DropdownMenuItem, DropdownMenuSeparator } from '@atd/ui/components/dropdown-menu';

/**
 * The actions of a list item, written once and shown both by its More button and by a right-click
 * (or Control-click) on the item. Radix scopes each menu's items to that menu, so an item renders
 * as the item of whichever menu holds it: the More dropdown by default, the context menu inside
 * `ItemContextMenu`. Every item with a More menu takes the same actions on right-click.
 */

type MenuKind = 'dropdown' | 'context';
const MenuKindContext = createContext<MenuKind>('dropdown');

/** A menu item for both menus; same props as `DropdownMenuItem`. */
export function ItemMenuItem(
  props: ComponentProps<typeof DropdownMenuItem> & ComponentProps<typeof ContextMenuItem>,
) {
  return use(MenuKindContext) === 'context' ? (
    <ContextMenuItem {...props} />
  ) : (
    <DropdownMenuItem {...props} />
  );
}

export function ItemMenuSeparator() {
  return use(MenuKindContext) === 'context' ? <ContextMenuSeparator /> : <DropdownMenuSeparator />;
}

/**
 * Opens `menu`, the item's More actions, where the user right-clicks `children`, the item's root
 * element (it takes the trigger's props and ref, and while the menu is open `data-state="open"`,
 * which keeps the row lit like an open More menu does). Without a menu the item keeps the
 * system's own context menu.
 */
export function ItemContextMenu({ menu, children }: { menu: ReactNode; children: ReactElement }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!menu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuKindContext value="context">{menu}</MenuKindContext>
      </ContextMenuContent>
    </ContextMenu>
  );
}
