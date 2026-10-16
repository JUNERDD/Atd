import { SelectGroup, SelectItem, SelectSeparator } from '@atd/ui/components/select';

/** The Select value of the "follow the command" item, which no option of these fields uses. */
export const FOLLOW = 'follow';

/**
 * The first item of a shortcut's override field: following the command, labelled with what that
 * is now, set apart from the field's own options. Renders nothing without a label, so the same
 * field serves the command itself.
 */
export function FollowItem({ label }: { label: string | undefined }) {
  if (label === undefined) return null;
  return (
    <>
      <SelectGroup>
        <SelectItem value={FOLLOW}>{label}</SelectItem>
      </SelectGroup>
      <SelectSeparator />
    </>
  );
}
