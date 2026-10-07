import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { SummonPanel } from '../../content/summon';
import './display.css';

interface SummonDisplayProps {
  ref: RefObject<HTMLDivElement | null>;
  open: boolean;
  shot: SummonPanel;
  unavailable: string;
}

/** A real native window rises over the same photograph used in the feature films. */
export function SummonDisplay({ ref, open, shot, unavailable }: SummonDisplayProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const onFail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth === 0) onFail();
  }, [onFail]);

  return (
    <div
      ref={ref}
      className="summon__viewport"
      aria-hidden="true"
      data-reveal-group=""
      data-open={open ? '' : undefined}
    >
      <div className="summon__screen display" data-reveal="power" data-reveal-delay="100">
        <img
          className="summon__wallpaper"
          src="/summon/background.jpg"
          width={1200}
          height={1000}
          alt=""
          loading="lazy"
          decoding="async"
        />
        <div className="summon__panel">
          {failed ? (
            <p className="summon__unavailable">{unavailable}</p>
          ) : (
            <img
              ref={imageRef}
              className="summon__shot"
              src={shot.src}
              width={shot.width}
              height={shot.height}
              alt=""
              loading="lazy"
              decoding="async"
              onError={onFail}
            />
          )}
        </div>
      </div>
    </div>
  );
}
