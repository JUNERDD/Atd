import { useEffect, useRef, useState } from 'react';
import type { CaseClip } from '../../content/cases';

interface CaseClipViewProps {
  clip: CaseClip;
  /** What the clip shows, for assistive technology. */
  alt: string;
  /** Plays the clip from its start, looping; when it turns off, the clip rests on its poster. */
  play: boolean;
  /** Loads the video before it plays, so the stage's next scenes start at once. */
  preload: boolean;
  /** The poster could not load: the showcase offers the video itself instead. */
  onError: () => void;
}

/**
 * One case's clip: its poster, a still of the result, with the video over it. The video loads only
 * when it is about to play, and shows only once it is playing, so a slow network or a browser that
 * refuses to start it (Low Power Mode, a data saver) leaves the poster rather than an empty frame.
 * Paused, it keeps its frame, so a clip leaving the stage fades out as it was; unloaded, the poster
 * shows again. Each clip fades up from black and back down at its ends, so its loop dips instead
 * of cutting.
 */
export function CaseClipView({ clip, alt, play, preload, onError }: CaseClipViewProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [rolling, setRolling] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (!play) {
      element.pause();
      return;
    }
    element.currentTime = 0;
    // A refused start is expected (Low Power Mode, a data saver): the clip never plays, so its
    // poster stays.
    element.play().catch(() => undefined);
  }, [play]);

  const load = play || preload;
  // Both load in CORS mode so the stage's glow can read their pixels (glow.tsx); the hosted media
  // answers with CORS headers (scripts/check-asset-delivery.mjs).
  return (
    <div className="cases__clip" data-rolling={rolling ? '' : undefined}>
      <img
        className="cases__poster"
        src={clip.poster}
        crossOrigin="anonymous"
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={onError}
      />
      <video
        ref={video}
        className="cases__video"
        src={load ? clip.video : undefined}
        crossOrigin="anonymous"
        aria-label={alt}
        muted
        loop
        playsInline
        preload={load ? 'auto' : 'none'}
        onPlaying={() => setRolling(true)}
        onEmptied={() => setRolling(false)}
        onError={() => setRolling(false)}
      />
    </div>
  );
}
