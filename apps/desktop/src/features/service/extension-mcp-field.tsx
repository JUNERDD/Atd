import type { ReactNode } from 'react';
import { Label } from '@ai/ui/components/label';
import { FieldHint } from '../../components/field-hint';

/**
 * One labelled control. The label row and the control stack are the field's only two children,
 * so parallel fields keep their shared label and control tracks (`aligned-fields`) while a
 * message grows below the control.
 */
export function McpField({
  id,
  label,
  hint,
  message,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  /** An inline problem (`error`) or a note about the current choice. */
  message?: string | undefined;
  error?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="settings-field">
      <div className="flex min-w-0 items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <FieldHint text={hint} /> : null}
      </div>
      <div className="settings-field">
        {children}
        {message ? (
          <p
            id={`${id}-message`}
            className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
            role={error ? 'alert' : undefined}
          >
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
