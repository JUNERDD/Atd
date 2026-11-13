import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Carousel, CarouselContent, CarouselItem } from '@atd/ui/components/carousel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atd/ui/components/dialog';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { useCarousel } from '@atd/ui/lib/carousel-context';
import { cn } from '@atd/ui/lib/utils';
import './panel-modal.css';

const WHEEL_SWIPE_THRESHOLD_PX = 24;
const WHEEL_SWIPE_COOLDOWN_MS = 320;

const PanelModalSlideContext = createContext({ isActive: true });

export interface PanelModalSlideProps {
  title: ReactNode;
  description?: ReactNode | undefined;
  /** Optional hero media rendered inside a concentric dark stage at the top of the slide. */
  media?: ReactNode | undefined;
  /** Optional body rendered inside a bounded ScrollArea between the header and footer. */
  children?: ReactNode | undefined;
  /** Optional footer actions; wraps cleanly and stacks full-width below 360px. */
  footer?: ReactNode | undefined;
  className?: string | undefined;
}

/**
 * Content layout for a single main-panel modal slide: concentric optional top media stage,
 * wrapping header copy, bounded scrolling body, and responsive footer actions.
 */
export function PanelModalSlide({
  title,
  description,
  media,
  children,
  footer,
  className,
}: PanelModalSlideProps) {
  const { isActive } = useContext(PanelModalSlideContext);
  const hasMedia = media !== undefined && media !== null;

  return (
    <div
      className={cn('panel-modal-slide', className)}
      data-has-media={hasMedia ? 'true' : 'false'}
    >
      {hasMedia && (
        <div className="panel-modal-media-cell">
          <div className="panel-modal-stage dark">{media}</div>
        </div>
      )}
      <div className="panel-modal-main">
        {isActive ? (
          <DialogHeader className="panel-modal-header">
            <div className="panel-modal-header-copy">
              <DialogTitle title={undefined} className="panel-modal-title">
                {title}
              </DialogTitle>
              {description && (
                <DialogDescription title={undefined} className="panel-modal-description">
                  {description}
                </DialogDescription>
              )}
            </div>
          </DialogHeader>
        ) : (
          <div data-slot="dialog-header" className="panel-modal-header">
            <div className="panel-modal-header-copy">
              <h2 data-slot="dialog-title" className="panel-modal-title">
                {title}
              </h2>
              {description && (
                <p data-slot="dialog-description" className="panel-modal-description">
                  {description}
                </p>
              )}
            </div>
          </div>
        )}
        {children && (
          <ScrollArea
            className="panel-modal-scroll"
            viewportClassName="overscroll-contain"
            gutter="none"
          >
            <div className="panel-modal-body">{children}</div>
          </ScrollArea>
        )}
        {footer && <DialogFooter className="panel-modal-footer">{footer}</DialogFooter>}
      </div>
    </div>
  );
}

export interface PanelModalDeckItem {
  id: string;
  hasMedia?: boolean | undefined;
  content: ReactNode;
}

export interface PanelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly PanelModalDeckItem[];
  /** Increments on open or manual reopen so an already-open deck jumps cleanly to `initialIndex`. */
  sessionKey?: number | undefined;
  initialIndex?: number | undefined;
  onActiveIndexChange?: ((index: number) => void) | undefined;
  /** Whether clicking outside, pressing Escape, or clicking Close can dismiss the modal. */
  dismissible?: boolean | undefined;
  /** Localized accessible label for the close button. */
  closeLabel: string;
  className?: string | undefined;
}

function PanelModalDeckBody({
  open,
  items,
  sessionKey,
  initialIndex,
  onActiveIndexChange,
  onClose,
  dismissible,
  closeLabel,
}: {
  open: boolean;
  items: readonly PanelModalDeckItem[];
  sessionKey: number;
  initialIndex: number;
  onActiveIndexChange?: ((index: number) => void) | undefined;
  onClose: () => void;
  dismissible: boolean;
  closeLabel: string;
}) {
  const { t } = useTranslation('panel');
  const { api, selectedIndex } = useCarousel();
  const lastWheelAtRef = useRef(0);
  const mountedKeyRef = useRef(sessionKey);
  const isMulti = items.length > 1;
  const clampedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
  const activeItem = items[clampedIndex];
  const activeHasMedia = activeItem?.hasMedia ?? false;

  useEffect(() => {
    if (!api || !onActiveIndexChange) return;
    const handleSelect = () => {
      onActiveIndexChange(api.selectedScrollSnap());
    };
    api.on('select', handleSelect);
    return () => {
      api.off('select', handleSelect);
    };
  }, [api, onActiveIndexChange]);

  useEffect(() => {
    if (!api || !open) return;
    if (mountedKeyRef.current === sessionKey) return;
    mountedKeyRef.current = sessionKey;
    api.reInit();
    api.scrollTo(Math.min(initialIndex, Math.max(0, items.length - 1)), true);
  }, [api, initialIndex, items.length, open, sessionKey]);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (!isMulti || !api) return;
    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    if (absX <= absY * 1.2 || absX < WHEEL_SWIPE_THRESHOLD_PX) return;
    const now = performance.now();
    if (now - lastWheelAtRef.current < WHEEL_SWIPE_COOLDOWN_MS) return;
    lastWheelAtRef.current = now;
    if (event.deltaX > 0) api.scrollNext();
    else api.scrollPrev();
  }

  return (
    <>
      {dismissible &&
        (activeHasMedia ? (
          <button
            type="button"
            className="panel-modal-media-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="panel-modal-close"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        ))}

      <CarouselContent
        className="ml-0 items-stretch"
        viewportClassName={cn(
          'panel-modal-viewport',
          isMulti && 'panel-modal-viewport-draggable touch-pan-y',
        )}
        onWheel={handleWheel}
      >
        {items.map((item, index) => {
          const isActive = index === clampedIndex;
          return (
            <CarouselItem key={item.id} className="pl-0" inert={!isActive ? true : undefined}>
              <PanelModalSlideContext.Provider value={{ isActive }}>
                {item.content}
              </PanelModalSlideContext.Provider>
            </CarouselItem>
          );
        })}
      </CarouselContent>

      {isMulti && (
        <nav
          className="panel-modal-pagination"
          aria-label={t('modals.carousel.paginationLabel', {
            current: clampedIndex + 1,
            total: items.length,
          })}
        >
          <ol className="panel-modal-pagination-list">
            {items.map((item, index) => {
              const current = index === clampedIndex;
              return (
                <li key={item.id} className="panel-modal-pagination-item">
                  <button
                    type="button"
                    className="panel-modal-dot-btn"
                    aria-label={t('modals.carousel.dotLabel', {
                      index: index + 1,
                      total: items.length,
                    })}
                    aria-current={current ? 'step' : undefined}
                    onClick={() => api?.scrollTo(index)}
                  >
                    <span className="panel-modal-dot" data-current={current ? 'true' : undefined} />
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {isMulti && (
        <p className="sr-only" aria-live="polite">
          {t('modals.carousel.slideAnnouncement', {
            current: clampedIndex + 1,
            total: items.length,
          })}
        </p>
      )}
    </>
  );
}

/**
 * Reusable main-panel feature modal built on `@atd/ui` Dialog (`material="backdrop"`) and
 * Embla Carousel with entrance/exit transitions, pointer/trackpad drag swiping across multiple
 * slides, keyboard Left/Right navigation, and compact pagination indicators.
 */
export function PanelModal({
  open,
  onOpenChange,
  items,
  sessionKey = 0,
  initialIndex = 0,
  onActiveIndexChange,
  dismissible = true,
  closeLabel,
  className,
}: PanelModalProps) {
  const { t } = useTranslation('panel');
  const reducedMotion = useReducedMotion() ?? false;
  const isMulti = items.length > 1;
  const clampedInitial = Math.min(initialIndex, Math.max(0, items.length - 1));
  const preventDismiss = dismissible ? undefined : (event: Event) => event.preventDefault();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        material="backdrop"
        showCloseButton={false}
        overlayClassName="panel-modal-overlay"
        data-multi={isMulti ? 'true' : 'false'}
        data-dismissible={dismissible ? 'true' : 'false'}
        className={cn('panel-modal', className)}
        onEscapeKeyDown={preventDismiss}
        onPointerDownOutside={preventDismiss}
        onInteractOutside={preventDismiss}
      >
        <Carousel
          className="panel-modal-carousel"
          aria-label={t('modals.carousel.regionLabel')}
          opts={{
            align: 'start',
            loop: false,
            watchDrag: isMulti,
            startIndex: clampedInitial,
            duration: reducedMotion ? 0 : 22,
          }}
        >
          <PanelModalDeckBody
            open={open}
            items={items}
            sessionKey={sessionKey}
            initialIndex={clampedInitial}
            onActiveIndexChange={onActiveIndexChange}
            onClose={() => onOpenChange(false)}
            dismissible={dismissible}
            closeLabel={closeLabel}
          />
        </Carousel>
      </DialogContent>
    </Dialog>
  );
}
