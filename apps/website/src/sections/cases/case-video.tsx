import { useEffect, useRef, useState } from 'react';
import type { CaseFrame, CaseVideo as CaseVideoSource } from '../../content/cases';

/** Intrinsic sizes that reserve each frame's box before anything loads (`panel` is 2× the panel). */
const SIZE: Record<CaseFrame, { width: number; height: number }> = {
  screen: { width: 1920, height: 1200 },
  panel: { width: 840, height: 1160 },
};

/** Main profile, level 5.0, 8-bit: covers 2560 × 1600 at 60 fps, so any export in the guide fits. */
const AV1_TYPE = 'video/webm; codecs="av01.0.12M.08"';

interface CaseVideoProps {
  video: CaseVideoSource;
  frame: CaseFrame;
  /** The card is current or next to it, and the gallery is near the viewport: start loading. */
  near: boolean;
  /** The card is current, playback is on, the gallery is in view and the page is visible. */
  play: boolean;
  /** The browser refused to start playback without a gesture. */
  onBlocked: () => void;
  /** The poster or the video could not be loaded; the card falls back to its test card. */
  onFail: () => void;
}

/**
 * A muted, looping recording. The poster image is always what shows first: it is a lazy `<img>`,
 * so it also works without JavaScript. The video attaches its sources (with `preload="none"`
 * until then) once the card is near, fades in over the poster when it has a frame, and plays only
 * while `play` holds.
 */
export function CaseVideo({ video, frame, near, play, onBlocked, onFail }: CaseVideoProps) {
  const posterRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);
  const { width, height } = SIZE[frame];

  // Once a card has been near, it keeps its sources: state adjusted while rendering, as React
  // recommends for state that follows a prop.
  if (near && !armed) setArmed(true);

  // A poster that failed before hydration never reported its error to React.
  useEffect(() => {
    const poster = posterRef.current;
    if (poster?.complete && poster.naturalWidth === 0) onFail();
  }, [onFail]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !armed) return;
    if (!play) {
      element.pause();
      return;
    }
    // React sets `muted` as a property only; autoplay policies need it before play().
    element.muted = true;
    element.play().catch((error: unknown) => {
      // A pause() that interrupts play() rejects with AbortError, which needs nothing.
      if (error instanceof DOMException && error.name === 'NotAllowedError') onBlocked();
    });
  }, [armed, play, onBlocked]);

  const show = () => setShown(true);

  return (
    <>
      <img
        ref={posterRef}
        className="case__poster"
        data-frame={frame}
        src={video.poster}
        width={width}
        height={height}
        alt=""
        loading="lazy"
        decoding="async"
        onError={onFail}
      />
      <video
        ref={videoRef}
        className="case__video"
        data-frame={frame}
        data-shown={shown ? '' : undefined}
        width={width}
        height={height}
        muted
        loop
        playsInline
        preload={armed ? 'auto' : 'none'}
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden="true"
        onLoadedData={show}
        onPlaying={show}
        onError={onFail}
      >
        {armed && video.av1 ? <source src={video.av1} type={AV1_TYPE} /> : null}
        {/* The last source reports the failure of all of them. */}
        {armed ? <source src={video.src} onError={onFail} /> : null}
      </video>
    </>
  );
}
