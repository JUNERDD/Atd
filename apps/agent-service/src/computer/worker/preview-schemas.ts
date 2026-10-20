import * as z from 'zod';
import { common, Origin, PageId } from './schemas.js';

const PreviewId = z.string().uuid();
export const previewStartInput = {
  previewId: PreviewId,
  pageId: PageId,
  boundPageId: PageId,
  expectedUrl: z.string().url().max(8192),
  allowedOrigins: z.array(Origin).min(1).max(32),
};
export const previewLeaseInput = { previewId: PreviewId };
export const previewOutput = {
  ...common,
  previewId: PreviewId.optional(),
  frame: z
    .object({
      sequence: z.number().int().positive(),
      capturedAt: z.number().positive(),
      base64: z.string().max(1_398_104),
    })
    .optional(),
};
