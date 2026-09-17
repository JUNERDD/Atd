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
    <output className="app-toast" data-kind={kind} data-visible={String(item.visible)}>
      <ToastIcon aria-hidden className="app-toast-icon" />
      <span>{text}</span>
      <IconButton
        label={t('toast.dismiss')}
        aria-label={t('toast.dismissLabel')}
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
