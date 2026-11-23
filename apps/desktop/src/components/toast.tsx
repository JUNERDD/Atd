import { useContext } from 'react';
import { toast, Toaster, type Toast } from 'react-hot-toast';
import { CircleAlert, Info, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { SettingsNavigationContext } from '../features/settings/settings-navigation';
import { IconButton } from './icon-button';
import './toast.css';

export type ToastKind = 'info' | 'warning' | 'error';

const toastIcons = {
  info: Info,
  warning: TriangleAlert,
  error: CircleAlert,
} as const;

/** A toast's own button beside its text, which also dismisses the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** How many characters before a name's extension stay visible when the name is shortened. */
const keptBeforeExtension = 6;

/**
 * A name on one line, shortened in the middle as Finder does: its extension and the characters
 * just before it never shrink, so a long hashed name stays recognizable at any width. The whole
 * name stays in the text, so assistive technology and the tooltip read all of it.
 */
function MiddleTruncatedName({ name }: { name: string }) {
  const characters = Array.from(name);
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 8 ? Array.from(name.slice(dot)).length : 0;
  const split = Math.max(0, characters.length - extension - keptBeforeExtension);
  return (
    <span className="flex min-w-0 text-muted-foreground" title={name}>
      {/* `whitespace-pre` keeps a space at the split that a collapsing line box would drop. */}
      <span className="overflow-hidden text-ellipsis whitespace-pre">
        {characters.slice(0, split).join('')}
      </span>
      <span className="shrink-0 whitespace-pre">{characters.slice(split).join('')}</span>
    </span>
  );
}

/**
 * One toast: its icon, `text`, and its buttons. With `detail` (the name of the file or folder it
 * is about), `text` is a short title and the name sits on a muted line below it.
 */
export function ToastCard({
  item,
  kind,
  text,
  detail,
  diagnose = false,
  action,
}: {
  item: Toast;
  kind: ToastKind;
  text: string;
  detail?: string;
  diagnose?: boolean;
  action?: ToastAction;
}) {
  const { t } = useTranslation('common');
  const navigateSettings = useContext(SettingsNavigationContext);
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
      {detail ? (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium wrap-anywhere">{text}</span>
          <MiddleTruncatedName name={detail} />
        </span>
      ) : (
        // A long unbroken word wraps instead of pushing the buttons out.
        <span className="min-w-0 wrap-anywhere">{text}</span>
      )}
      {diagnose && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => {
            toast.dismiss(item.id);
            if (navigateSettings) {
              navigateSettings('diagnostics');
            } else {
              void window.desktop?.settings?.openSection('diagnostics').catch(() => undefined);
            }
          }}
        >
          {t('toast.openDiagnostics')}
        </Button>
      )}
      {action && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => {
            toast.dismiss(item.id);
            action.run();
          }}
        >
          {action.label}
        </Button>
      )}
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
