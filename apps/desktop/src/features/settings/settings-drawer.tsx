import { useRef, type ReactNode } from 'react';
import { Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@ai/ui/components/sheet';
import { IconButton } from '../../components/icon-button';

/**
 * The navigation below 480px: a menu button in the content header opens the sidebar card as a
 * modal sheet. Radix contains focus while it is open, returns it to the menu button, and closes on
 * Escape and on the backdrop; the window closes it after navigating.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  const content = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <IconButton label={t('drawer.menu')} aria-label={t('drawer.menuLabel')} disabled={disabled}>
          <Menu />
        </IconButton>
      </SheetTrigger>
      <SheetContent
        ref={content}
        side="left"
        showCloseButton={false}
        className="settings-drawer transition-none data-open:fade-in-100 data-[side=left]:data-open:slide-in-from-left data-closed:fade-out-100 data-[side=left]:data-closed:slide-out-to-left motion-reduce:animate-none"
        overlayClassName="settings-drawer-overlay duration-200 motion-reduce:animate-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          content.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus();
        }}
      >
        <SheetTitle className="sr-only">{t('drawer.title')}</SheetTitle>
        <SheetDescription className="sr-only">{t('drawer.description')}</SheetDescription>
        {/* The native traffic lights sit at this strip's leading end. */}
        <header className="settings-drawer-header">
          <SheetClose asChild>
            <IconButton label={t('drawer.close')} aria-label={t('drawer.closeLabel')}>
              <X />
            </IconButton>
          </SheetClose>
        </header>
        {children}
      </SheetContent>
    </Sheet>
  );
}
