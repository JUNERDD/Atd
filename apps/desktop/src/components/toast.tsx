import { toast, Toaster, type Toast } from 'react-hot-toast';
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './icon-button';
import './toast.css';

export type ToastKind = 'info' | 'warning' | 'error';

const toastIcons = {
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
} as const;

export function ToastCard({ item, kind, text }: { item: Toast; kind: ToastKind; text: string }) {
  const { t } = useTranslation('common');
  const ToastIcon = toastIcons[kind];
  return (
    <output
      className="app-toast flex w-fit max-w-full items-center gap-2 rounded-2xl border border-border bg-card py-1.5 pr-2 pl-3 text-xs"
      data-kind={kind}
      data-visible={String(item.visible)}
    >
      <ToastIcon
        aria-hidden
        className={
          kind === 'error'
            ? 'size-4 shrink-0 text-destructive'
            : 'size-4 shrink-0 text-muted-foreground'
        }
      />
      <span>{text}</span>
      <IconButton
        label={t('toast.dismiss')}
        aria-label={t('toast.dismissLabel')}
        // The X is self-explanatory, and a tooltip would cover the toast's text.
        tooltip={false}
        onClick={() => toast.dismiss(item.id)}
      >
        <X />
      </IconButton>
    </output>
  );
}

/** Global toast host. `top` keeps the region below the owning window's own header. */
export function ToastHost({ top }: { top: number }) {
  return <Toaster position="top-center" containerStyle={{ top }} />;
}
