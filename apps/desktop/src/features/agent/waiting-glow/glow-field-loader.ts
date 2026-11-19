import { lazyWithPreload } from '../../../lib/lazy-with-preload';

const glowField = lazyWithPreload(() =>
  import('./glow-field-canvas').then((module) => module.GlowField),
);

export const GlowField = glowField.Component;
export const preloadGlowField = glowField.preload;
