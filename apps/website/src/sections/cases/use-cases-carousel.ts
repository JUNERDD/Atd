import Autoplay from 'embla-carousel-autoplay';
import Fade from 'embla-carousel-fade';
import useEmblaCarousel from 'embla-carousel-react';
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { cases } from '../../content/cases';
import { useInView } from '../../lib/use-in-view';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { sceneTiming } from './scenes';

/** Each slide's hold, in slide order, as Embla's per-snap autoplay delays. */
const DURATIONS = cases.map((item) => sceneTiming[item.id].duration);
const durationOf = (index: number) => DURATIONS[index] ?? sceneTiming[cases[0].id].duration;

/**
 * Embla owns the crossfade and playback; this hook connects page visibility, the visitor's choice
 * and each scene's timing. Scenes change only through the controls, never by dragging.
 */
export function useCasesCarousel() {
  const root = useRef<HTMLElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const inView = useInView(root, { threshold: 0.2 });
  // Scenes wait, hidden, for the first time the carousel is seen (scenes.css), then play in.
  const started = useInView(root, { threshold: 0.2, once: true });
  const reducedMotion = useReducedMotion();
  const [manualPlay, setManualPlay] = useState<boolean | null>(null);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rotationEnabled = manualPlay ?? !reducedMotion;
  const autoplay = useMemo(
    () =>
      Autoplay({
        delay: () => DURATIONS,
        playOnInit: false,
        stopOnInteraction: true,
        stopOnMouseEnter: false,
        stopOnFocusIn: false,
      }),
    [],
  );
  const [viewport, api] = useEmblaCarousel(
    { loop: true, watchDrag: false, duration: reducedMotion ? 0 : 28 },
    [autoplay, Fade()],
  );

  useEffect(() => {
    if (!api) return;
    const select = () => setActive(api.selectedScrollSnap());
    const play = () => setPlaying(true);
    const stop = () => setPlaying(false);
    select();
    api
      .on('select', select)
      .on('reInit', select)
      .on('autoplay:play', play)
      .on('autoplay:stop', stop);
    return () => {
      api
        .off('select', select)
        .off('reInit', select)
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
      const duration = durationOf(api.selectedScrollSnap());
      animation = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration,
        easing: reducedMotion ? 'steps(3, end)' : 'linear',
        fill: 'forwards',
      });
      animation.currentTime = duration - remaining;
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
      if (inView && rotationEnabled) playback.play(reducedMotion);
      else playback.stop();
    };
    api.on('reInit', syncPlayback);
    syncPlayback();
    return () => {
      api.off('reInit', syncPlayback);
      api.plugins().autoplay.stop();
    };
  }, [api, inView, rotationEnabled, reducedMotion]);

  function pauseOnFocus(event: FocusEvent<HTMLElement>) {
    // Pointer clicks must reach the playback button before changing its play/pause state.
    if (!event.target.matches(':focus-visible')) return;
    api?.plugins().autoplay.stop();
    setManualPlay(false);
  }

  /**
   * The scene tabs and the previous and next buttons keep playback as it was: a running timer
   * restarts with the new scene's hold, and a paused carousel stays paused.
   */
  function go(move: (carousel: NonNullable<typeof api>) => void) {
    if (!api) return;
    move(api);
    api.plugins().autoplay.reset();
  }

  function select(index: number) {
    go((carousel) => carousel.scrollTo(index, reducedMotion));
  }

  function previous() {
    go((carousel) => carousel.scrollPrev(reducedMotion));
  }

  function next() {
    go((carousel) => carousel.scrollNext(reducedMotion));
  }

  function toggle() {
    setManualPlay(!rotationEnabled);
  }

  return {
    root,
    progress,
    intervalSeconds: durationOf(active) / 1000,
    viewport,
    active,
    started,
    entered: inView,
    playing,
    rotationEnabled,
    pauseOnFocus,
    select,
    previous,
    next,
    toggle,
  };
}
