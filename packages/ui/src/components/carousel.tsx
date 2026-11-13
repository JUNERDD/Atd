'use client';

import * as React from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import {
  CarouselContext,
  useCarousel,
  type CarouselApi,
  type CarouselProps,
} from '@atd/ui/lib/carousel-context';
import { cn } from '@atd/ui/lib/utils';

interface CarouselSnapshot {
  canScrollPrev: boolean;
  canScrollNext: boolean;
  selectedIndex: number;
  scrollSnapCount: number;
}

const EMPTY_SNAPSHOT: CarouselSnapshot = {
  canScrollPrev: false,
  canScrollNext: false,
  selectedIndex: 0,
  scrollSnapCount: 0,
};

function readCarouselSnapshot(api: CarouselApi | undefined): CarouselSnapshot {
  if (!api) return EMPTY_SNAPSHOT;
  return {
    canScrollPrev: api.canScrollPrev(),
    canScrollNext: api.canScrollNext(),
    selectedIndex: api.selectedScrollSnap(),
    scrollSnapCount: api.scrollSnapList().length,
  };
}

function sameSnapshot(a: CarouselSnapshot, b: CarouselSnapshot): boolean {
  return (
    a.canScrollPrev === b.canScrollPrev &&
    a.canScrollNext === b.canScrollNext &&
    a.selectedIndex === b.selectedIndex &&
    a.scrollSnapCount === b.scrollSnapCount
  );
}

function useCarouselSnapshot(api: CarouselApi | undefined): CarouselSnapshot {
  const cachedRef = React.useRef<CarouselSnapshot>(EMPTY_SNAPSHOT);

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      if (!api) return () => {};
      const handleChange = () => {
        cachedRef.current = readCarouselSnapshot(api);
        onStoreChange();
      };
      api.on('reInit', handleChange);
      api.on('select', handleChange);
      return () => {
        api.off('reInit', handleChange);
        api.off('select', handleChange);
      };
    },
    [api],
  );

  const getSnapshot = React.useCallback(() => {
    const next = readCarouselSnapshot(api);
    if (sameSnapshot(cachedRef.current, next)) return cachedRef.current;
    cachedRef.current = next;
    return next;
  }, [api]);

  return React.useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
}

function Carousel({
  orientation = 'horizontal',
  opts,
  setApi,
  plugins,
  className,
  children,
  onKeyDownCapture,
  ...props
}: React.ComponentProps<'section'> & CarouselProps) {
  const [carouselRef, api] = useEmblaCarousel(
    {
      ...opts,
      axis: orientation === 'horizontal' ? 'x' : 'y',
    },
    plugins,
  );
  const snapshot = useCarouselSnapshot(api);

  const scrollPrev = React.useCallback(() => {
    api?.scrollPrev();
  }, [api]);

  const scrollNext = React.useCallback(() => {
    api?.scrollNext();
  }, [api]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      onKeyDownCapture?.(event);
      if (event.defaultPrevented) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        scrollPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        scrollNext();
      }
    },
    [onKeyDownCapture, scrollPrev, scrollNext],
  );

  React.useEffect(() => {
    if (!api || !setApi) return;
    setApi(api);
  }, [api, setApi]);

  return (
    <CarouselContext.Provider
      value={{
        carouselRef,
        api,
        opts,
        orientation: orientation || (opts?.axis === 'y' ? 'vertical' : 'horizontal'),
        scrollPrev,
        scrollNext,
        canScrollPrev: snapshot.canScrollPrev,
        canScrollNext: snapshot.canScrollNext,
        selectedIndex: snapshot.selectedIndex,
        scrollSnapCount: snapshot.scrollSnapCount,
      }}
    >
      <section
        onKeyDownCapture={handleKeyDown}
        className={cn('relative', className)}
        aria-roledescription="carousel"
        data-slot="carousel"
        {...props}
      >
        {children}
      </section>
    </CarouselContext.Provider>
  );
}

function CarouselContent({
  className,
  viewportClassName,
  ...props
}: React.ComponentProps<'div'> & { viewportClassName?: string }) {
  const { carouselRef, orientation } = useCarousel();

  return (
    <div
      ref={carouselRef}
      className={cn('overflow-hidden', viewportClassName)}
      data-slot="carousel-content"
    >
      <div
        className={cn('flex', orientation === 'horizontal' ? '-ml-4' : '-mt-4 flex-col', className)}
        {...props}
      />
    </div>
  );
}

function CarouselItem({ className, ...props }: React.ComponentProps<'div'>) {
  const { orientation } = useCarousel();

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- WAI-ARIA carousel slide pattern pairs role="group" with aria-roledescription="slide".
      role="group"
      aria-roledescription="slide"
      data-slot="carousel-item"
      className={cn(
        'min-w-0 shrink-0 grow-0 basis-full',
        orientation === 'horizontal' ? 'pl-4' : 'pt-4',
        className,
      )}
      {...props}
    />
  );
}

function CarouselPrevious({
  className,
  variant = 'outline',
  size = 'icon-sm',
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollPrev, canScrollPrev } = useCarousel();

  return (
    <Button
      data-slot="carousel-previous"
      variant={variant}
      size={size}
      className={cn(
        'absolute touch-manipulation rounded-2xl',
        orientation === 'horizontal'
          ? 'inset-y-0 -left-12 my-auto'
          : '-top-12 left-1/2 -translate-x-1/2 rotate-90',
        className,
      )}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      {...props}
    >
      <ChevronLeftIcon className="cn-rtl-flip" />
      <span className="sr-only">Previous slide</span>
    </Button>
  );
}

function CarouselNext({
  className,
  variant = 'outline',
  size = 'icon-sm',
  ...props
}: React.ComponentProps<typeof Button>) {
  const { orientation, scrollNext, canScrollNext } = useCarousel();

  return (
    <Button
      data-slot="carousel-next"
      variant={variant}
      size={size}
      className={cn(
        'absolute touch-manipulation rounded-2xl',
        orientation === 'horizontal'
          ? 'inset-y-0 -right-12 my-auto'
          : '-bottom-12 left-1/2 -translate-x-1/2 rotate-90',
        className,
      )}
      disabled={!canScrollNext}
      onClick={scrollNext}
      {...props}
    >
      <ChevronRightIcon className="cn-rtl-flip" />
      <span className="sr-only">Next slide</span>
    </Button>
  );
}

export { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext };
