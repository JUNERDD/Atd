import Autoplay from 'embla-carousel-autoplay';
import useEmblaCarousel from 'embla-carousel-react';
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { useInView } from '../../lib/use-in-view';
import { useReducedMotion } from '../../lib/use-reduced-motion';

const INTERVAL_MS = 3000;

/** Embla owns dragging and playback; this hook connects page visibility and the visitor's choice. */
export function useCasesCarousel() {
  const root = useRef<HTMLElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const inView = useInView(root, { threshold: 0.2 });
  const reducedMotion = useReducedMotion();
  const [manualPlay, setManualPlay] = useState<boolean | null>(null);
  const [pressed, setPressed] = useState(false);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rotationEnabled = manualPlay ?? !reducedMotion;
  const autoplay = useMemo(
    () =>
      Autoplay({
        delay: INTERVAL_MS,
        playOnInit: false,
        stopOnInteraction: true,
        stopOnMouseEnter: false,
        stopOnFocusIn: false,
      }),
    [],
  );
  const [viewport, api] = useEmblaCarousel({ loop: true, duration: reducedMotion ? 0 : 28 }, [
    autoplay,
  ]);

  useEffect(() => {
    if (!api) return;
    const select = () => setActive(api.selectedScrollSnap());
    const play = () => setPlaying(true);
    const stop = () => setPlaying(false);
    const press = () => setPressed(true);
    const release = () => setPressed(false);
    select();
    api
      .on('select', select)
      .on('reInit', select)
      .on('reInit', release)
      .on('pointerDown', press)
      .on('pointerUp', release)
      .on('autoplay:play', play)
      .on('autoplay:stop', stop);
    return () => {
      api
        .off('select', select)
        .off('reInit', select)
        .off('reInit', release)
        .off('pointerDown', press)
        .off('pointerUp', release)
        .off('autoplay:play', play)
        .off('autoplay:stop', stop);
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const fill = progress.current;
    if (!fill) return;
    let animation: Animation | null = null;
    const reset = () => {
      animation?.cancel();
      animation = null;
    };
    const start = () => {
      const remaining = api.plugins().autoplay.timeUntilNext();
      if (remaining === null) return;
      reset();
      // Follow Embla's actual timer, including restarts after a hold, visibility and resize.
      animation = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration: INTERVAL_MS,
        easing: reducedMotion ? 'steps(3, end)' : 'linear',
        fill: 'forwards',
      });
      animation.currentTime = INTERVAL_MS - remaining;
    };
    const stop = () => animation?.pause();
    api
      .on('autoplay:timerset', start)
      .on('autoplay:timerstopped', stop)
      .on('select', reset)
      .on('reInit', reset);
    start();
    return () => {
      api
        .off('autoplay:timerset', start)
        .off('autoplay:timerstopped', stop)
        .off('select', reset)
        .off('reInit', reset);
      reset();
    };
  }, [api, reducedMotion]);

  useEffect(() => {
    if (!api) return;
    const syncPlayback = () => {
      const playback = api.plugins().autoplay;
      if (inView && rotationEnabled && !pressed) playback.play(reducedMotion);
      else playback.stop();
    };
    api.on('reInit', syncPlayback);
    syncPlayback();
    return () => {
      api.off('reInit', syncPlayback);
      api.plugins().autoplay.stop();
    };
  }, [api, inView, rotationEnabled, pressed, reducedMotion]);

  function pause() {
    api?.plugins().autoplay.stop();
    setManualPlay(false);
  }

  function pauseOnFocus(event: FocusEvent<HTMLElement>) {
    // Pointer clicks must reach the playback button before changing its play/pause state.
    if (event.target.matches(':focus-visible')) pause();
  }

  function select(index: number) {
    pause();
    api?.scrollTo(index, reducedMotion);
  }

  function previous() {
    pause();
    api?.scrollPrev(reducedMotion);
  }

  function next() {
    pause();
    api?.scrollNext(reducedMotion);
  }

  function toggle() {
    setManualPlay(!rotationEnabled);
  }

  return {
    root,
    progress,
    intervalSeconds: INTERVAL_MS / 1000,
    viewport,
    active,
    playing,
    rotationEnabled,
    pauseOnFocus,
    select,
    previous,
    next,
    toggle,
  };
}
