import type { FrameSetup, TransitionKind } from './frame.ts';
import { TRANSITION_COMMON, TRANSITION_VERTEX } from './glsl.ts';
import { RIPPLE_GLSL } from './ripple-glsl.ts';
import { SWEEP_GLSL } from './sweep-glsl.ts';

const BODY: Record<TransitionKind, string> = { ripple: RIPPLE_GLSL, sweep: SWEEP_GLSL };

const UNIFORMS = [
  'u_tex',
  'u_size',
  'u_dpr',
  'u_origin',
  'u_t',
  'u_time',
  'u_dark',
  'u_tint',
  'u_glow',
  'u_shift',
  'u_frozen',
  'u_live',
  'u_reach',
  'u_band',
] as const;
type Uniform = (typeof UNIFORMS)[number];

interface Program {
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  /** Resolved once linking is known to have worked. */
  uniforms: Map<Uniform, WebGLUniformLocation | null> | null;
}

/** One frame's moving parts: progress, seconds since the first frame, and the live surfaces. */
export interface TransitionTick {
  t: number;
  time: number;
  /** Atd's surfaces where they are now (`maskRects`). */
  live: Float32Array;
}

/**
 * The transitions' WebGL2 runner: one canvas, its context, a program per kind and the frame's
 * texture. Programs start compiling at `prepare`, so the GPU process works while the tab is
 * captured, and are checked only at `load`. The canvas's backing store follows its CSS box at the
 * frame's device pixel ratio on every draw, so the frame stays 1:1 however the viewport's height
 * changes. A context that cannot be had, or only with a major performance caveat (software
 * rendering), yields no surface; a lost one (GPU reset, a heavy page reclaiming memory) is
 * reported to `lost` and never drawn on again.
 */
export class TransitionSurface {
  private readonly programs = new Map<TransitionKind, Program>();
  private texture: WebGLTexture | null = null;
  private current: Program | null = null;
  private disposed = false;
  /** A program did not build on a live context: this machine cannot draw transitions. */
  broken = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
    lost: () => void,
  ) {
    canvas.addEventListener('webglcontextlost', () => {
      if (!this.disposed) lost();
    });
    const buffer = gl.createBuffer();
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /** A surface on `canvas`, or null where WebGL2 is unavailable or only in software. */
  static open(canvas: HTMLCanvasElement, lost: () => void): TransitionSurface | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    });
    return gl ? new TransitionSurface(canvas, gl, lost) : null;
  }

  /** Starts building `kind`'s program without waiting for it. */
  prepare(kind: TransitionKind): void {
    if (this.programs.has(kind)) return;
    const gl = this.gl;
    const program = gl.createProgram();
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    if (!program || !vertex || !fragment) return;
    gl.shaderSource(vertex, TRANSITION_VERTEX);
    gl.shaderSource(fragment, TRANSITION_COMMON + BODY[kind]);
    gl.compileShader(vertex);
    gl.compileShader(fragment);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'a_pos');
    gl.linkProgram(program);
    this.programs.set(kind, { program, vertex, fragment, uniforms: null });
  }

  /**
   * Makes `frame` (flipped so its first row is the bottom one) the texture `kind` draws; false
   * when it cannot be drawn: the program failed (`broken`), the context is lost, or the frame is
   * larger than a texture may be.
   */
  load(kind: TransitionKind, frame: ImageBitmap): boolean {
    const gl = this.gl;
    if (gl.isContextLost()) return false;
    this.prepare(kind);
    const program = this.programs.get(kind);
    if (!program || !this.ready(program)) return false;
    const max: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (typeof max !== 'number' || frame.width > max || frame.height > max) return false;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    // The sweep's haze reads a blurred level.
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.current = program;
    return true;
  }

  /** Draws one frame of the loaded transition over the canvas's current box. */
  draw(setup: FrameSetup, tick: TransitionTick): void {
    const gl = this.gl;
    const program = this.current;
    const uniforms = program?.uniforms;
    if (!program || !uniforms || gl.isContextLost()) return;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * setup.dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * setup.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const at = (name: Uniform) => uniforms.get(name) ?? null;
    gl.uniform1i(at('u_tex'), 0);
    gl.uniform2f(at('u_size'), setup.size[0], setup.size[1]);
    gl.uniform1f(at('u_dpr'), setup.dpr);
    gl.uniform2f(at('u_origin'), setup.origin[0], setup.origin[1]);
    gl.uniform1f(at('u_t'), tick.t);
    gl.uniform1f(at('u_time'), tick.time);
    gl.uniform1f(at('u_dark'), setup.darkness);
    gl.uniform3fv(at('u_tint'), setup.tint);
    gl.uniform3fv(at('u_glow'), setup.glow);
    // The frame hangs from the viewport's top left: its bottom is this far below the canvas's.
    gl.uniform1f(at('u_shift'), setup.pixels[1] - height);
    gl.uniform4fv(at('u_frozen'), setup.frozen);
    gl.uniform4fv(at('u_live'), tick.live);
    gl.uniform1f(at('u_reach'), setup.reach);
    gl.uniform1f(at('u_band'), setup.band);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Gives the GPU context back at once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.texture = null;
    this.current = null;
  }

  /** Waits for whatever compiling is left and resolves the uniforms once. */
  private ready(entry: Program): boolean {
    if (entry.uniforms) return true;
    const gl = this.gl;
    if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
      const log =
        gl.getShaderInfoLog(entry.fragment) ||
        gl.getShaderInfoLog(entry.vertex) ||
        gl.getProgramInfoLog(entry.program);
      console.debug('[Atd] page transition unavailable:', log);
      this.broken = !gl.isContextLost();
      return false;
    }
    entry.uniforms = new Map(
      UNIFORMS.map((name) => [name, gl.getUniformLocation(entry.program, name)]),
    );
    return true;
  }
}
