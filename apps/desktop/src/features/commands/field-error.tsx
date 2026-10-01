import { CircleAlert } from 'lucide-react';

/**
 * An error under the field it concerns: the shared `settings-inline-error` text with its icon.
 * The field names `id` in `aria-describedby` and sets `aria-invalid` while this is shown.
 */
export function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="settings-inline-error">
      <CircleAlert aria-hidden />
      {children}
    </p>
  );
}
