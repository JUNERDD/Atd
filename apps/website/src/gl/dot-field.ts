import {
  createArtRasterizer,
  defaultArtBox,
  type ArtRasterizer,
  type GridLayout,
} from './art-raster';
import { observeField } from './field-signals';
import { createResources, deleteResources, uploadArt, type GlResources } from './gl-resources';
import { bindPointer, createPointerState } from './pointer';
import { createQualityGovernor } from './quality';
import { createSpring, snapSpring, stepSpring } from './spring';
import type { Box, DotField, DotFieldOptions, FocusRect, Rgb } from './types';

const MAX_DPR = 2;
/** Power-on length, including the art flashes settling. */
const BOOT_SECONDS = 1.6;
/** Boot clock value that means "settled" to the shader. */
const BOOT_SETTLED = 1e4;
const RIPPLE_SECONDS = 1.2;
const MAX_RIPPLES = 4;
const MAX_RECTS = 2;
const LENS_ZOOM = 1.75;
/** Lens springs in rad/s: the position tracks tightly (settles in ~0.11 s), the strength eases. */
const LENS_FOLLOW = 42;
const LENS_FADE = 14;
const DEFAULT_FONT = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [1, 1, 1];

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

/**
 * Creates a dot-matrix field on `canvas`, or returns null when WebGL2 (or the shader) is unavailable,
 * in which case the host keeps its DOM fallback. The field draws only while the canvas intersects
 * the viewport and the document is visible: continuously in full motion, on demand under reduced
 * motion. Listeners write to local state that the frame loop reads; one draw call per frame.
 */
export function createDotField(
  canvas: HTMLCanvasElement,
  options: DotFieldOptions = {},
): DotField | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  const rasterizer = createArtRasterizer();
  if (!gl || !rasterizer) return null;
  // A context that is already lost (e.g. a remount during a GPU reset) builds its objects on restore.
  const resources = gl.isContextLost() ? null : createResources(gl);
  if (!resources && !gl.isContextLost()) return null;
  return runField(canvas, gl, rasterizer, resources, options);
}

function runField(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  rasterizer: ArtRasterizer,
  initialResources: GlResources | null,
  options: DotFieldOptions,
): DotField {
  let resources = initialResources;
  const pitchRange = options.pitch ?? [10, 14];
  const fontFamily = options.fontFamily ?? DEFAULT_FONT;
  const fontWeight = options.fontWeight ?? 900;
  const ink = options.ink ?? BLACK;
  const dot = options.dot ?? WHITE;
  const fieldLevel = options.fieldLevel ?? 0.13;
  const focusDim = options.focusDim ?? 0.65;
  let text = options.text ?? 'Atd';
  let artBox: Box | null = null;
  let layout: GridLayout = { pitch: 12, originX: 0, originY: 0, cols: 1, rows: 1 };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let sizeDirty = true;
  let artDirty = true;
  let reduced = options.reducedMotion ?? false;
  let bootStart = -1;
  let bootDone = reduced || options.boot === false;
  let scroll = 0;
  const rects = new Float32Array(MAX_RECTS * 4);
  const rectShape = new Float32Array(MAX_RECTS * 2);
  let rectCount = 0;
  // x, y, start time (s), amplitude per ripple; a start far in the past marks a free slot.
  const ripples = new Float32Array(MAX_RIPPLES * 4);
  for (let i = 0; i < MAX_RIPPLES; i++) ripples[i * 4 + 2] = -BOOT_SETTLED;
  let nextRipple = 0;
  let lastRippleAt = -BOOT_SETTLED;

  const pointer = createPointerState();
  const lensX = createSpring();
  const lensY = createSpring();
  const lensStrength = createSpring();
  const quality = createQualityGovernor();
  const epoch = performance.now();
  let raf = 0;
  let lastFrame = 0;
  let active = false;
  let lost = gl.isContextLost();
  let destroyed = false;
  let live = false;

  const setLive = (next: boolean) => {
    if (live === next) return;
    live = next;
    options.onLive?.(next);
  };
  const schedule = () => {
    if (raf !== 0 || destroyed || lost || !active || !resources) return;
    raf = requestAnimationFrame(frame);
  };
  const cancel = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = 0;
  };

  function applySize(): void {
    sizeDirty = false;
    const scale = reduced ? 1 : quality.scale;
    const pixelWidth = Math.max(1, Math.round(width * dpr * scale));
    const pixelHeight = Math.max(1, Math.round(height * dpr * scale));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    quality.reset();
  }

  function applyArt(target: GlResources): void {
    artDirty = false;
    const raster = rasterizer.rasterize(width, height, {
      text,
      fontFamily,
      fontWeight,
      pitchRange,
      box: artBox ?? defaultArtBox(width, height),
    });
    layout = raster.layout;
    uploadArt(gl, target.art, raster.coverage, layout.cols, layout.rows);
    quality.reset();
  }

  function frame(now: number): void {
    raf = 0;
    const target = resources;
    if (!target || width === 0 || height === 0) return;
    const interval = lastFrame === 0 ? 0 : now - lastFrame;
    lastFrame = now;
    const dt = Math.min(interval / 1000, 0.05);
    if (!reduced && interval > 0 && interval < 250 && quality.sample(interval)) sizeDirty = true;
    const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    if (nextDpr !== dpr) {
      dpr = nextDpr;
      sizeDirty = true;
    }
    if (sizeDirty) applySize();
    if (artDirty) applyArt(target);

    const time = (now - epoch) / 1000;
    if (bootStart < 0) bootStart = now;
    const boot = bootDone ? BOOT_SETTLED : (now - bootStart) / 1000;
    if (boot >= BOOT_SECONDS) bootDone = true;

    // The pointer is stored in viewport coordinates; adding the live scroll keeps the lens under it
    // while the page scrolls without pointer events.
    const lensTargetX = pointer.clientX + window.scrollX - pointer.originX;
    const lensTargetY = pointer.clientY + window.scrollY - pointer.originY;
    const engaged = pointer.engaged ? 1 : 0;
    if (reduced || lensStrength.value < 0.01) {
      snapSpring(lensX, lensTargetX);
      snapSpring(lensY, lensTargetY);
    } else {
      stepSpring(lensX, lensTargetX, LENS_FOLLOW, dt);
      stepSpring(lensY, lensTargetY, LENS_FOLLOW, dt);
    }
    if (reduced) snapSpring(lensStrength, engaged);
    else stepSpring(lensStrength, engaged, LENS_FADE, dt);
    const lensRadius = Math.min(190, Math.max(90, Math.max(width, height) * 0.1));

    const u = target.uniforms;
    gl.useProgram(target.program);
    gl.bindVertexArray(target.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.art);
    gl.uniform2f(u.u_res, canvas.width, canvas.height);
    gl.uniform1f(u.u_scale, canvas.width / width);
    gl.uniform1f(u.u_time, time);
    gl.uniform1f(u.u_motion, reduced ? 0 : 1);
    gl.uniform1f(u.u_boot, boot);
    gl.uniform1f(u.u_scroll, scroll);
    gl.uniform3f(u.u_grid, layout.originX, layout.originY, layout.pitch);
    gl.uniform2i(u.u_cells, layout.cols, layout.rows);
    gl.uniform4f(u.u_lens, lensX.value, lensY.value, lensRadius, lensStrength.value);
    gl.uniform1f(u.u_zoom, LENS_ZOOM);
    gl.uniform4fv(u.u_ripples, ripples);
    gl.uniform4fv(u.u_rects, rects);
    gl.uniform2fv(u.u_rectShape, rectShape);
    gl.uniform1i(u.u_rectCount, rectCount);
    gl.uniform3f(u.u_levels, fieldLevel, 1, focusDim);
    gl.uniform3f(u.u_ink, ink[0], ink[1], ink[2]);
    gl.uniform3f(u.u_dot, dot[0], dot[1], dot[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    setLive(true);

    // Reduced motion draws on demand; only a fading tap glow keeps it going.
    if (!reduced || time - lastRippleAt < RIPPLE_SECONDS) schedule();
  }

  const unobserve = observeField(canvas, {
    onResize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      sizeDirty = true;
      artDirty = true;
      schedule();
    },
    onActive(next) {
      active = next;
      if (next) schedule();
      else cancel();
    },
    onContextLost() {
      lost = true;
      resources = null;
      cancel();
      setLive(false);
    },
    onContextRestored() {
      lost = false;
      resources = createResources(gl);
      sizeDirty = true;
      artDirty = true;
      schedule();
    },
  });

  const unbindPointer = bindPointer(options.pointerTarget ?? canvas, canvas, pointer, {
    onChange: schedule,
    onTap(clientX, clientY) {
      const slot = nextRipple * 4;
      nextRipple = (nextRipple + 1) % MAX_RIPPLES;
      lastRippleAt = (performance.now() - epoch) / 1000;
      ripples[slot] = clientX + window.scrollX - pointer.originX;
      ripples[slot + 1] = clientY + window.scrollY - pointer.originY;
      ripples[slot + 2] = lastRippleAt;
      ripples[slot + 3] = 1;
      schedule();
    },
  });

  return {
    setArt(next) {
      if (next === text) return;
      text = next;
      artDirty = true;
      schedule();
    },
    setArtBox(box) {
      if (sameBox(box, artBox)) return;
      artBox = box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
      artDirty = true;
      schedule();
    },
    setFocusRects(list: readonly FocusRect[]) {
      rectCount = 0;
      for (const rect of list.slice(0, MAX_RECTS)) {
        const halfWidth = rect.width / 2;
        const halfHeight = rect.height / 2;
        rects.set([rect.x + halfWidth, rect.y + halfHeight, halfWidth, halfHeight], rectCount * 4);
        rectShape.set(
          [Math.min(rect.radius, halfWidth, halfHeight), Math.max(1, rect.feather)],
          rectCount * 2,
        );
        rectCount += 1;
      }
      schedule();
    },
    setScroll(progress) {
      const next = Math.min(1, Math.max(0, progress));
      if (next === scroll) return;
      scroll = next;
      schedule();
    },
    setReducedMotion(next) {
      if (next === reduced) return;
      reduced = next;
      if (next) bootDone = true;
      sizeDirty = true;
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      unobserve();
      unbindPointer();
      if (resources && !gl.isContextLost()) deleteResources(gl, resources);
      resources = null;
      setLive(false);
    },
  };
}
