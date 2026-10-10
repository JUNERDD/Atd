import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ONBOARDING_THEME, ONBOARDING_THEME_URL } from './assets/onboarding-theme';

/** The guide's music as the stage and its toggles use it. */
export interface OnboardingMusic {
  /** The user turned the music off; it keeps playing silently so unmuting stays in time. */
  muted: boolean;
  /** False when Web Audio is missing or the track fails to load or decode; the toggle hides. */
  available: boolean;
  /** Turns the music off or back on with a short ramp. */
  toggle(): void;
  /**
   * Fades the music out and stops it, for closing the guide. Returns how long the fade takes, in
   * seconds: 0 when nothing is audible (not started yet, muted, unavailable or already faded).
   */
  fadeOut(): number;
}

/** Seconds of the fade-in when playback starts, so a late start never begins with a click. */
const FADE_IN = 1;
/** Seconds of the mute and unmute ramp. */
const TOGGLE_RAMP = 0.2;
/** Seconds of the fade-out when the guide closes. */
const FADE_OUT = 0.8;
/** Seconds between scheduling the start and the first sample, so it lands on time. */
const LEAD = 0.05;

type Phase = 'loading' | 'playing' | 'stopped';

/** The audio graph: source → `fade` → `mute` → output. */
interface Audio {
  context: AudioContext;
  fade: GainNode;
  mute: GainNode;
  source: AudioBufferSourceNode | null;
}

/** Where in the track `elapsed` seconds of the guide fall, wrapping into the looped bed. */
function trackPosition(elapsed: number) {
  const { loopStart, loopEnd } = ONBOARDING_THEME;
  if (elapsed < loopEnd) return Math.max(0, elapsed);
  return loopStart + ((elapsed - loopStart) % (loopEnd - loopStart));
}

/** Ramps `param` from wherever it is now to `value` over `seconds`. */
function rampTo(context: AudioContext, param: AudioParam, value: number, seconds: number) {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

function createAudio(muted: boolean): Audio {
  const context = new AudioContext();
  const fade = context.createGain();
  const mute = context.createGain();
  fade.gain.value = 0;
  mute.gain.value = muted ? 0 : 1;
  fade.connect(mute).connect(context.destination);
  return { context, fade, mute, source: null };
}

async function fetchTrack(context: AudioContext, signal: AbortSignal) {
  const response = await fetch(ONBOARDING_THEME_URL, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return context.decodeAudioData(await response.arrayBuffer());
}

/**
 * The welcome guide's music (`assets/onboarding-theme.ts`), played through Web Audio so the bed
 * loops without a gap. `startedAt` (a `performance.now()` time) is the track's t=0, which may
 * still be ahead (the opening page starts the music a moment into its dimming): playback is
 * scheduled for it, and when loading finishes late it starts at the elapsed
 * offset, so the bloom at `revealAt` still lands where the opening page's light lands. The guide's
 * web view allows autoplay; a context that still starts suspended is asked to resume, and the
 * music starts once it runs.
 *
 * Two gain stages keep the envelopes apart: `fade` carries the fade-in and the closing fade-out,
 * `mute` the toggle, so muting during a fade neither cuts nor restarts it. `initiallyMuted` is the
 * toggle a resumed guide saved.
 */
export function useOnboardingMusic(startedAt: number, initiallyMuted: boolean): OnboardingMusic {
  const [muted, setMuted] = useState(initiallyMuted);
  const [available, setAvailable] = useState(() => typeof AudioContext !== 'undefined');
  const mutedRef = useRef(initiallyMuted);
  const phaseRef = useRef<Phase>('loading');
  const audioRef = useRef<Audio | null>(null);

  useEffect(() => {
    if (typeof AudioContext === 'undefined') return;
    const controller = new AbortController();
    let audio: Audio | null = null;
    let begin: (() => void) | null = null;
    phaseRef.current = 'loading';

    // Everything up to the first `await` runs before this effect returns, so the cleanup always
    // sees the graph; any failure, the context's constructor included, rejects instead.
    async function start() {
      const current = createAudio(mutedRef.current);
      audio = current;
      audioRef.current = current;
      const { context, fade } = current;
      const buffer = await fetchTrack(context, controller.signal);
      if (controller.signal.aborted) return;
      // Starts once the track is decoded and the context runs, whichever comes last; a fade-out
      // requested while loading wins, and the music never starts.
      begin = () => {
        if (phaseRef.current !== 'loading' || context.state !== 'running') return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.loopStart = ONBOARDING_THEME.loopStart;
        source.loopEnd = ONBOARDING_THEME.loopEnd;
        source.connect(fade);
        const latency = Number.isFinite(context.outputLatency) ? context.outputLatency : 0;
        const elapsed = (performance.now() - startedAt) / 1000 + LEAD + latency;
        // A track whose t=0 is still ahead waits for it; one already under way joins in time.
        const at = context.currentTime + LEAD + Math.max(0, -elapsed);
        fade.gain.setValueAtTime(0, at);
        fade.gain.linearRampToValueAtTime(1, at + FADE_IN);
        source.start(at, trackPosition(elapsed));
        current.source = source;
        phaseRef.current = 'playing';
      };
      context.addEventListener('statechange', begin);
      if (context.state === 'suspended') {
        // `statechange` calls `begin` once the context runs.
        context.resume().catch((error: unknown) => {
          console.error('The welcome guide music could not resume:', error);
        });
      }
      begin();
    }

    start().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.error('The welcome guide music could not play:', error);
      phaseRef.current = 'stopped';
      setAvailable(false);
    });

    return () => {
      controller.abort();
      phaseRef.current = 'stopped';
      if (!audio) return;
      if (begin) audio.context.removeEventListener('statechange', begin);
      audio.source?.stop();
      if (audioRef.current === audio) audioRef.current = null;
      void audio.context.close();
    };
  }, [startedAt]);

  const toggle = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    const audio = audioRef.current;
    if (audio) rampTo(audio.context, audio.mute.gain, next ? 0 : 1, TOGGLE_RAMP);
  }, []);

  const fadeOut = useCallback(() => {
    const audio = audioRef.current;
    const wasPlaying = phaseRef.current === 'playing';
    phaseRef.current = 'stopped';
    if (!audio?.source || !wasPlaying) return 0;
    const { context, fade, source } = audio;
    if (mutedRef.current) {
      source.stop();
      return 0;
    }
    rampTo(context, fade.gain, 0, FADE_OUT);
    source.stop(context.currentTime + FADE_OUT);
    return FADE_OUT;
  }, []);

  return useMemo(
    () => ({ muted, available, toggle, fadeOut }),
    [muted, available, toggle, fadeOut],
  );
}
