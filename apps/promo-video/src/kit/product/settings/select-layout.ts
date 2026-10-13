/** The shared Select's geometry in points, for placing a menu and what sits below it. */
/** A `SelectItem`'s height in points: `min-h-7` grown by its `py-1.5` around a 20 pt line. */
export const SELECT_ITEM_HEIGHT = 32;
/** The menu's padding (`p-1`) and its gap below the trigger (`sideOffset`). */
export const SELECT_MENU_PAD = 4;
export const SELECT_OFFSET = 4;
/** The trigger's height at its default size (`h-8`). */
export const SELECT_TRIGGER_HEIGHT = 32;
/** A `SelectSeparator`: a 1 pt line with 4 pt above and below it. */
export const SELECT_SEPARATOR_HEIGHT = 9;

/** The menu's height for `items`, for placing what sits below it. */
export function selectMenuHeight(items: readonly (string | null)[]): number {
  const rows = items.filter((item) => item !== null).length;
  return (
    SELECT_MENU_PAD * 2 +
    rows * SELECT_ITEM_HEIGHT +
    (items.length - rows) * SELECT_SEPARATOR_HEIGHT
  );
}
