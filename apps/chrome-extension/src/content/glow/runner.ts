import { GLOW_FRAGMENT, GLOW_UNIFORMS, GLOW_VERTEX, type GlowUniform } from './shader.ts';

/** One frame of the light, in CSS px where it says so. */
export interface GlowFrame {
  phase: number;
  since: number;
  entry: boolean;
  /** The bloom's origin in CSS px from the viewport's top left. */
  origin: readonly [number, number];
  band: number;
  level: number;
  hue: number;
  /** The 24 mesh colours, flattened (`u_colors`). */
  colors: Float32Array;
}

/** The light renders at the display's resolution (so its dither survives), up to this scale. */
const MAX_SCALE = 2;
/** The band's corners never round wider than this (CSS px). */
const MAX_RADIUS = 60;

/**
 * A small WebGL2 runner for the light's shader: one full-screen triangle, its uniforms, the
 * canvas size and device pixel ratio. A lost context (GPU reset, a heavy page reclaiming memory)
 * stops drawing until it is restored, when the program is built again. A context that cannot be
 * had, or only with a major performance caveat (software rendering), leaves the light off.
 */
export class GlowSurface {
  private gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private uniforms = new Map<GlowUniform, WebGLUniformLocation | null>();
  private lost = false;
  /** The shader did not build on a live context: this machine cannot draw the light. */
  private broken = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: true,
    });
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      this.program = null;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.build();
    });
    this.build();
  }

  /** Whether the light can draw at all on this machine and page. */
  get supported(): boolean {
    return this.gl !== null && !this.broken;
  }

  draw(frame: GlowFrame): void {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program || this.lost) return;
    const scale = Math.min(devicePixelRatio || 1, MAX_SCALE);
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    const set = (name: GlowUniform) => this.uniforms.get(name) ?? null;
    gl.uniform2f(set('u_res'), width, height);
    gl.uniform1f(set('u_phase'), frame.phase);
    gl.uniform1f(set('u_since'), frame.since);
    gl.uniform1f(set('u_entry'), frame.entry ? 1 : 0);
    // The origin arrives in CSS px from the top left; the shader wants device px from the bottom.
    gl.uniform2f(set('u_origin'), frame.origin[0] * scale, (cssHeight - frame.origin[1]) * scale);
    gl.uniform1f(set('u_band'), frame.band * scale);
    gl.uniform1f(set('u_radius'), Math.min(frame.band, MAX_RADIUS) * scale);
    gl.uniform1f(set('u_level'), frame.level);
    gl.uniform1f(set('u_hue'), frame.hue);
    gl.uniform3fv(set('u_colors'), frame.colors);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Gives the GPU context back at once (the light has left, or the instance is going away). */
  dispose(): void {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.gl = null;
    this.program = null;
  }

  private build(): void {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    const vertex = compile(gl, gl.VERTEX_SHADER, GLOW_VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, GLOW_FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      this.broken = !gl.isContextLost();
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.debug('[Atd] tab light unavailable:', gl.getProgramInfoLog(program));
      this.broken = !gl.isContextLost();
      return;
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.uniforms = new Map(
      GLOW_UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
    );
    this.program = program;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.debug('[Atd] tab light unavailable:', gl.getShaderInfoLog(shader));
  return null;
}
