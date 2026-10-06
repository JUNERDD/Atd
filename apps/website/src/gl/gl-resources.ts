import { linkProgram } from './gl-program';
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
  u_artNext: WebGLUniformLocation | null;
  u_shape: WebGLUniformLocation | null;
  u_shapeNext: WebGLUniformLocation | null;
  u_morph: WebGLUniformLocation | null;
  u_cells: WebGLUniformLocation | null;
  u_artBox: WebGLUniformLocation | null;
  u_pivot: WebGLUniformLocation | null;
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
    u_artNext: at('u_artNext'),
    u_shape: at('u_shape'),
    u_shapeNext: at('u_shapeNext'),
    u_morph: at('u_morph'),
    u_cells: at('u_cells'),
    u_artBox: at('u_artBox'),
    u_pivot: at('u_pivot'),
    u_lens: at('u_lens'),
    u_zoom: at('u_zoom'),
    u_ripples: at('u_ripples'),
    u_levels: at('u_levels'),
    u_ink: at('u_ink'),
    u_dot: at('u_dot'),
  };
}

/**
 * GL objects owned by one field. They die with the context and are rebuilt after a restore. `art`
 * is a blank placeholder; once the art is rasterized, `words` holds each word's coverage and
 * `shapes` its signed distance field (what a change melts from one word into the next).
 */
export interface GlResources {
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  art: WebGLTexture;
  words: WebGLTexture[];
  shapes: WebGLTexture[];
  uniforms: Uniforms;
}

/** Builds the program, an empty VAO for the attribute-less triangle, and a placeholder art texture. */
export function createResources(gl: WebGL2RenderingContext): GlResources | null {
  const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
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
  gl.uniform1i(uniforms.u_artNext, 1);
  gl.uniform1i(uniforms.u_shape, 2);
  gl.uniform1i(uniforms.u_shapeNext, 3);
  uploadArt(gl, art, new Uint8Array(1), 1, 1);
  return { program, vao, art, words: [], shapes: [], uniforms };
}

export function deleteResources(gl: WebGL2RenderingContext, resources: GlResources): void {
  gl.deleteProgram(resources.program);
  gl.deleteVertexArray(resources.vao);
  for (const texture of [...resources.words, ...resources.shapes]) {
    if (texture !== resources.art) gl.deleteTexture(texture);
  }
  gl.deleteTexture(resources.art);
}

/** A word's two textures: its coverage and its signed distance field. */
export interface WordTextures {
  coverage: Uint8Array;
  shape: Float32Array;
}

/**
 * Replaces the word textures: per word, its coverage (mipmapped, see uploadArt) and its signed
 * distance field (32-bit float, read exactly with texelFetch). A failed allocation reuses the blank.
 */
export function uploadWords(
  gl: WebGL2RenderingContext,
  resources: GlResources,
  words: readonly WordTextures[],
  cols: number,
  rows: number,
): void {
  for (const texture of [...resources.words, ...resources.shapes]) {
    if (texture !== resources.art) gl.deleteTexture(texture);
  }
  resources.words = words.map(({ coverage }) => {
    const texture = gl.createTexture();
    if (!texture) return resources.art;
    uploadArt(gl, texture, coverage, cols, rows);
    return texture;
  });
  resources.shapes = words.map(({ shape }) => {
    const texture = gl.createTexture();
    if (!texture) return resources.art;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cols, rows, 0, gl.RED, gl.FLOAT, shape);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  });
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
