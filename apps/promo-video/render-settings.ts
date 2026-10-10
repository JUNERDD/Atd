/**
 * The film's encode, shared by `remotion.config.ts` (Remotion Studio and the `remotion` CLI) and
 * `scripts/render.ts` (which calls `renderMedia()` and never reads the config file), so both
 * produce the same file.
 */
import type { RenderMediaOptions } from '@remotion/renderer';

export const ENCODING = {
  // Frames are captured as near-lossless JPEG: the interface's small type and the soft light
  // gradients band visibly at the default quality. The encode keeps that detail through H.264.
  imageFormat: 'jpeg',
  jpegQuality: 96,
  codec: 'h264',
  crf: 15,
  x264Preset: 'slow',
  pixelFormat: 'yuv420p',
  // Without it the frames' full-range JPEG colour passes through as full range, which many players
  // and upload pipelines misread (lifted blacks or crushed shadows). Limited-range BT.709, tagged,
  // is what they all expect.
  colorSpace: 'bt709',
  audioBitrate: '320k',
  overwrite: true,
} as const satisfies Partial<RenderMediaOptions>;
