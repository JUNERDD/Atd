import { useEffect, useRef, type RefObject } from 'react';

/** The clip is read this small: each light needs only its quarter's average color. */
const SAMPLE_W = 32;
const SAMPLE_H = 18;
/** A playing clip is read at most this often; each light eases to its new color (cases.css). */
const INTERVAL = 125;
/**
 * Seconds at each end of a clip whose frames are left out: every clip fades up from black and back
 * down over its first and last 0.35 s (the films repository's CASE_DIP), and a screen fading
 * through black at its loop is not the light the case casts.
 */
const FADE = 0.4;
/** Each light is its quarter's average lifted this much, so the plate reads lit rather than dim. */
const LIFT = 1.15;

/** One quarter's running sums of each channel. */
const quarter = (): [number, number, number] => [0, 0, 0];

/**
 * Lights the glow's four quarters, in reading order, with the colors of the clip's matching
 * quarters: the playing video's frames while it rolls, its poster before. A quarter's light is its
 * plain average, as a screen casts the mean of what it shows: a white window over the blue desktop
 * casts a pale blue, not white. Returns the cleanup; the lights keep their last colors, so the next
 * clip relights them from there.
 */
function attachGlow(glow: HTMLElement, clip: HTMLElement): () => void {
  const lights = glow.querySelectorAll<HTMLElement>(':scope > span');
  const poster = clip.querySelector<HTMLImageElement>('.cases__poster');
  const video = clip.querySelector<HTMLVideoElement>('.cases__video');
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const context = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  let readable = context !== null;
  let sampled = -Infinity;
  let frame: number | undefined;
  let byVideo = false;

  const sample = () => {
    // Stacked, the stage and its glow are not rendered: nothing to light.
    if (!readable || !context || !glow.clientWidth) return;
    let source: HTMLVideoElement | HTMLImageElement;
    if (video && !video.paused && video.readyState >= 2) {
      if (video.currentTime < FADE || video.duration - video.currentTime < FADE) return;
      source = video;
    } else if (poster?.complete && poster.naturalWidth) source = poster;
    else return;
    try {
      context.drawImage(source, 0, 0, SAMPLE_W, SAMPLE_H);
      const pixels = context.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      const top = [quarter(), quarter()] as const;
      const bottom = [quarter(), quarter()] as const;
      for (let pixel = 0; pixel < SAMPLE_W * SAMPLE_H; pixel++) {
        const row = pixel < (SAMPLE_W * SAMPLE_H) / 2 ? top : bottom;
        const zone = pixel % SAMPLE_W < SAMPLE_W / 2 ? row[0] : row[1];
        const [r = 0, g = 0, b = 0] = pixels.subarray(pixel * 4, pixel * 4 + 3);
        zone[0] += r;
        zone[1] += g;
        zone[2] += b;
      }
      const count = (SAMPLE_W * SAMPLE_H) / 4;
      const colors = [...top, ...bottom].map((zone) => zone.map((sum) => sum / count));
      colors.forEach((average, index) => {
        const color = average.map((value) => Math.min(255, value * LIFT));
        const light = lights.item(index);
        light.style.backgroundColor = `rgb(${color.map((value) => value.toFixed(1)).join(' ')})`;
      });
    } catch {
      // Pixels that can't be read (media served without CORS) leave the light as it was.
      readable = false;
    }
  };

  const stop = () => {
    if (frame === undefined) return;
    if (byVideo) video?.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = undefined;
  };
  // While the video plays, once per new frame (or display frame), at most every INTERVAL.
  const follow = () => {
    if (!video || video.paused || frame !== undefined || !readable) return;
    const next = (now: number) => {
      frame = undefined;
      if (now - sampled >= INTERVAL) {
        sampled = now;
        sample();
      }
      follow();
    };
    byVideo = typeof video.requestVideoFrameCallback === 'function';
    frame = byVideo ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
  };

  const abort = new AbortController();
  const options = { signal: abort.signal };
  poster?.addEventListener('load', sample, options);
  video?.addEventListener('playing', follow, options);
  video?.addEventListener('pause', stop, options);
  sample();
  follow();
  return () => {
    abort.abort();
    stop();
    canvas.width = canvas.height = 0;
  };
}

interface CaseGlowProps {
  /** The stage's screen, whose slides hold one clip per case, in the cases' order. */
  screen: RefObject<HTMLDivElement | null>;
  /** The current case, whose clip lights the plate. */
  active: number;
}

/**
 * The screen's light on the plate: four soft lights behind the screen, each the color of its
 * quarter of the current clip. A new case relights them from the colors they have, so the plate
 * never swaps a picture (cases.css).
 */
export function CaseGlow({ screen, active }: CaseGlowProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const clip = screen.current?.children[active]?.querySelector<HTMLElement>('.cases__clip');
    if (!root.current || !clip) return;
    return attachGlow(root.current, clip);
  }, [screen, active]);
  return (
    <div ref={root} className="cases__glow" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
