import { MovingImage, type Motion } from '../ui/Move.tsx';
import type { SceneLayer } from './scene.ts';

/** A scene layer at its place on the screen, with whatever motion the scene gives it. */
export function Layer({ layer, motion }: { layer: SceneLayer; motion?: Motion }) {
  return <MovingImage src={layer.src} box={layer} {...(motion ? { motion } : {})} />;
}

/** One horizontal band of a layer, rows `top` to `bottom` of its own box, so lists can arrive row by row. */
export function LayerBand({
  layer,
  top,
  bottom,
  motion = {},
}: {
  layer: SceneLayer;
  top: number;
  bottom: number;
  motion?: Motion;
}) {
  return (
    <Layer
      layer={layer}
      motion={{ ...motion, clip: `inset(${top}px 0 ${layer.height - bottom}px 0)` }}
    />
  );
}
