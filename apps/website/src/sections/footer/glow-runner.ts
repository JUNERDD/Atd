import { observeField } from '../../gl/field-signals';
import { linkProgram } from '../../gl/gl-program';
import { VERTEX_SHADER } from '../../gl/shaders';
import {
  FRAME_MS,
  GLOW_DOTS,
  GLOW_SHADER,
  MAX_COLUMNS,
  TEXEL,
  WAKE_SECONDS,
  WAKE_SETTLED,
  fieldScale,
  meshColumns,
  meshLevels,
  type GlowTheme,
} from './glow-field';

/** The longest step the clock takes, so the light resumes where it paused. */
const MAX_STEP_MS = 50;

/** The power-on draws every display frame until it has settled; then the light drops to `FRAME_MS`. */
const FULL_RATE_MS = (WAKE_SECONDS + 0.2) * 1000;

/** Under reduced motion the light rests at this field time, without a power-on. */
const STILL_PHASE = 0;

interface Program {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  at: (name: string) => WebGLUniformLocation | null;
}

function build(gl: WebGL2RenderingContext): Program | null {
  const program = linkProgram(gl, VERTEX_SHADER, GLOW_SHADER);
  const vao = program ? gl.createVertexArray() : null;
  if (!program || !vao) {
    if (program) gl.deleteProgram(program);
    return null;
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };
  return { program, vao, at };
}

export interface FooterGlowOptions {
  theme: GlowTheme;
  reducedMotion: boolean;
  /** The light has drawn (true) or can no longer draw (false), so its host can show or retire it. */
  onLive: (live: boolean) => void;
}

export interface FooterGlow {
  /** The footer is in view: the light powers on, once. Under reduced motion it is already on. */
  ignite(): void;
  setTheme(theme: GlowTheme): void;
  setReducedMotion(reduced: boolean): void;
  destroy(): void;
}

/**
 * Runs the footer's light on `canvas`, or returns null without WebGL2, leaving the footer plain.
 * The drawing buffer holds one texel per `TEXEL` CSS px whatever the pixel ratio, so it stays a
 * few kilobytes; the compositor scales it to the glow's box. The light draws only while the canvas
 * is near the viewport and the document is visible (`observeField`), at 30 frames a second after
 * a full-rate power-on, and once per change under reduced motion. Its clock advances only while it
 * draws, so it resumes where it paused. A frame allocates nothing.
 */
export function createFooterGlow(
  canvas: HTMLCanvasElement,
  options: FooterGlowOptions,
): FooterGlow | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  // A context that is already lost (a remount during a GPU reset) builds its program on restore.
  const program = gl.isContextLost() ? null : build(gl);
  if (!program && !gl.isContextLost()) return null;
  return runGlow(canvas, gl, program, options);
}

function runGlow(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
  initialProgram: Program | null,
  options: FooterGlowOptions,
): FooterGlow {
  let program = initialProgram;
  const mesh = new Float32Array(MAX_COLUMNS * 4);
  const scale = new Float32Array(2);
  let theme = options.theme;
  let reduced = options.reducedMotion;
  let width = 0;
  let height = 0;
  let active = false;
  let ignited = false;
  let destroyed = false;
  let live = false;
  /** Milliseconds the light has run since its power-on began. */
  let clock = 0;
  let raf = 0;
  let last = 0;

  const setLive = (next: boolean) => {
    if (live === next) return;
    live = next;
    options.onLive(next);
  };
  const showing = () => ignited || reduced;
  const schedule = () => {
    if (raf !== 0 || destroyed || !active || !program || !showing()) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  };

  function draw(target: Program): void {
    if (width === 0 || height === 0) return;
    const columns = Math.max(2, Math.round(width / TEXEL));
    const rows = Math.max(2, Math.round(height / TEXEL));
    if (canvas.width !== columns) canvas.width = columns;
    if (canvas.height !== rows) canvas.height = rows;
    gl.viewport(0, 0, columns, rows);
    const seconds = clock / 1000;
    // The field starts from its still frame and moves at its own pace as the light comes up.
    const phase = reduced ? STILL_PHASE : seconds;
    const dot = GLOW_DOTS[theme];
    gl.useProgram(target.program);
    gl.bindVertexArray(target.vao);
    gl.uniform2f(target.at('u_res'), columns, rows);
    gl.uniform2fv(target.at('u_scale'), fieldScale(width, height, scale));
    gl.uniform1f(target.at('u_phase'), phase);
    gl.uniform1f(target.at('u_wake'), reduced ? WAKE_SETTLED : seconds);
    const meshWidth = meshColumns(width, height);
    gl.uniform1i(target.at('u_columns'), meshWidth);
    gl.uniform1fv(target.at('u_mesh'), meshLevels(phase, meshWidth, mesh));
    gl.uniform3f(target.at('u_dot'), dot[0], dot[1], dot[2]);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    setLive(true);
  }

  function tick(now: number): void {
    raf = 0;
    const target = program;
    if (!target || !active || destroyed) return;
    if (reduced) {
      draw(target);
      return;
    }
    raf = requestAnimationFrame(tick);
    // Two milliseconds of slack, so a display's own frames at the target rate are never skipped.
    if (last !== 0 && clock >= FULL_RATE_MS && now - last < FRAME_MS - 2) return;
    if (last !== 0) clock += Math.min(now - last, MAX_STEP_MS);
    last = now;
    draw(target);
  }

  const unobserve = observeField(canvas, {
    onResize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      // A running light picks the new size up on its next frame; a still one redraws now.
      if (reduced) schedule();
    },
    onActive(next) {
      active = next;
      if (next) schedule();
      else cancel();
    },
    onContextLost() {
      program = null;
      cancel();
      setLive(false);
    },
    onContextRestored() {
      program = build(gl);
      schedule();
    },
  });

  return {
    ignite() {
      if (ignited) return;
      ignited = true;
      schedule();
    },
    setTheme(next) {
      if (next === theme) return;
      theme = next;
      schedule();
    },
    setReducedMotion(next) {
      if (next === reduced) return;
      reduced = next;
      cancel();
      if (!next && live) {
        // The still light was already on: it starts moving without powering on again, or, if the
        // footer has not come into view yet, waits for it with nothing drawn.
        if (ignited) clock = Math.max(clock, FULL_RATE_MS);
        else {
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          setLive(false);
        }
      }
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancel();
      unobserve();
      if (program && !gl.isContextLost()) {
        gl.deleteVertexArray(program.vao);
        gl.deleteProgram(program.program);
      }
      program = null;
      setLive(false);
    },
  };
}
