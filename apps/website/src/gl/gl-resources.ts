import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';

/** Uniform locations, looked up once per program. A null location is an optimized-out uniform. */
export interface Uniforms {
  u_res: WebGLUniformLocation | null;
  u_scale: WebGLUniformLocation | null;
  u_time: WebGLUniformLocation | null;
  u_motion: WebGLUniformLocation | null;
  u_boot: WebGLUniformLocation | null;
  u_scroll: WebGLUniformLocation | null;
  u_grid: WebGLUniformLocation | null;
  u_art: WebGLUniformLocation | null;
  u_cells: WebGLUniformLocation | null;
  u_artBox: WebGLUniformLocation | null;
  u_lens: WebGLUniformLocation | null;
  u_zoom: WebGLUniformLocation | null;
  u_ripples: WebGLUniformLocation | null;
  u_levels: WebGLUniformLocation | null;
  u_ink: WebGLUniformLocation | null;
  u_dot: WebGLUniformLocation | null;
}

function locateUniforms(gl: WebGL2RenderingContext, program: WebGLProgram): Uniforms {
  const at = (name: keyof Uniforms) => gl.getUniformLocation(program, name);
  return {
    u_res: at('u_res'),
    u_scale: at('u_scale'),
    u_time: at('u_time'),
    u_motion: at('u_motion'),
    u_boot: at('u_boot'),
    u_scroll: at('u_scroll'),
    u_grid: at('u_grid'),
    u_art: at('u_art'),
    u_cells: at('u_cells'),
    u_artBox: at('u_artBox'),
    u_lens: at('u_lens'),
    u_zoom: at('u_zoom'),
    u_ripples: at('u_ripples'),
    u_levels: at('u_levels'),
    u_ink: at('u_ink'),
    u_dot: at('u_dot'),
  };
}

/** GL objects owned by one field. They die with the context and are rebuilt after a restore. */
export interface GlResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  art: WebGLTexture;
  uniforms: Uniforms;
}

function compile(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  console.warn('[dot-field] shader compile failed:', gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (program && vertex && fragment) {
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
  }
  if (vertex) gl.deleteShader(vertex);
  if (fragment) gl.deleteShader(fragment);
  if (!program) return null;
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;
  console.warn('[dot-field] program link failed:', gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

/** Builds the program, an empty VAO for the attribute-less triangle, and a placeholder art texture. */
export function createResources(gl: WebGL2RenderingContext): GlResources | null {
  const program = link(gl);
  if (!program) return null;
  const vao = gl.createVertexArray();
  const art = gl.createTexture();
  if (!vao || !art) {
    if (vao) gl.deleteVertexArray(vao);
    if (art) gl.deleteTexture(art);
    gl.deleteProgram(program);
    return null;
  }
  const uniforms = locateUniforms(gl, program);
  gl.useProgram(program);
  gl.uniform1i(uniforms.u_art, 0);
  uploadArt(gl, art, new Uint8Array(1), 1, 1);
  return { program, vao, art, uniforms };
}

export function deleteResources(gl: WebGL2RenderingContext, resources: GlResources): void {
  gl.deleteProgram(resources.program);
  gl.deleteVertexArray(resources.vao);
  gl.deleteTexture(resources.art);
}

/**
 * Uploads per-cell coverage as a single-channel texture. Level 0 is read exactly with texelFetch;
 * the mip chain gives the shader a cheap blurred copy for the haze and the halo.
 */
export function uploadArt(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  coverage: Uint8Array,
  cols: number,
  rows: number,
): void {
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, coverage);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
}
