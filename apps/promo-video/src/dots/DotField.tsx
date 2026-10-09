import { useLayoutEffect, useRef } from 'react';
import { HEIGHT, WIDTH } from '../timeline.ts';
import './dot-field.css';
import { drawField, type FieldState } from './field.ts';
import type { FieldRaster } from './raster.ts';

interface DotFieldProps {
  raster: FieldRaster | null;
  state: FieldState;
  /** Scales the display about a point, for the dive into the cursor. */
  zoom?: { scale: number; originX: number; originY: number };
}

/** The LED display, drawn afresh for every frame from its state. */
export function DotField({ raster, state, zoom }: DotFieldProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bloom = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    const bloomCtx = bloom.current?.getContext('2d');
    if (!ctx || !bloomCtx || !raster) return;
    drawField(ctx, raster, state, WIDTH, HEIGHT);
    bloomCtx.clearRect(0, 0, WIDTH / 4, HEIGHT / 4);
    bloomCtx.drawImage(ctx.canvas, 0, 0, WIDTH / 4, HEIGHT / 4);
  });

  return (
    <div
      className="dot-field"
      style={{
        '--zoom': zoom?.scale,
        '--zoom-origin': zoom ? `${zoom.originX}px ${zoom.originY}px` : undefined,
      }}
    >
      <canvas ref={canvas} className="dot-field__canvas" width={WIDTH} height={HEIGHT} />
      <canvas ref={bloom} className="dot-field__bloom" width={WIDTH / 4} height={HEIGHT / 4} />
    </div>
  );
}
