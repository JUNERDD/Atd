import { Type } from 'typebox';
import { Empty } from './primitives.ts';

/** Only the dedicated diagnostic build records; exporting is restricted to its Settings page. */
export const NativeDiagnosticCalls = {
  'diagnostics.state': {
    params: Empty,
    result: Type.Object(
      {
        enabled: Type.Boolean(),
        focusEnabled: Type.Boolean(),
        recording: Type.Boolean(),
        cleanupFailed: Type.Boolean(),
        /** Native-owned wall deadline in Unix seconds; null while stopped. */
        expiresAt: Type.Union([Type.Number(), Type.Null()]),
        accessibilityTrusted: Type.Boolean(),
        mouseTapActive: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  },
  'diagnostics.prepare': { params: Empty, result: Empty },
  'diagnostics.start': { params: Empty, result: Empty },
  'diagnostics.stop': {
    params: Empty,
    result: Type.Object({ cleanupFailed: Type.Boolean() }, { additionalProperties: false }),
  },
  'diagnostics.export': {
    params: Empty,
    result: Type.Object(
      { saved: Type.Boolean(), cleanupFailed: Type.Boolean() },
      { additionalProperties: false },
    ),
  },
};

export const NativeDiagnosticEvents = {
  'diagnostics.recording': Type.Object(
    { recording: Type.Boolean() },
    { additionalProperties: false },
  ),
};

/** No arbitrary text fields: a page cannot put content, keys or URLs in the diagnostic trace. */
export const NativeDiagnosticPosts = {
  'diagnostics.page': Type.Object(
    {
      event: Type.Union([
        Type.Literal('ready'),
        Type.Literal('error'),
        Type.Literal('unhandledrejection'),
        Type.Literal('resize'),
        Type.Literal('heartbeat'),
        Type.Literal('pointerdown'),
        Type.Literal('pointerup'),
        Type.Literal('click'),
        Type.Literal('focus'),
        Type.Literal('blur'),
        Type.Literal('visibilitychange'),
      ]),
      timestamp: Type.Number(),
      width: Type.Number(),
      height: Type.Number(),
      elapsed: Type.Union([Type.Number(), Type.Null()]),
      hasFocus: Type.Boolean(),
      visible: Type.Boolean(),
      target: Type.Union([
        Type.Literal('input'),
        Type.Literal('textarea'),
        Type.Literal('button'),
        Type.Literal('link'),
        Type.Literal('editable'),
        Type.Literal('other'),
      ]),
      x: Type.Union([Type.Number(), Type.Null()]),
      y: Type.Union([Type.Number(), Type.Null()]),
    },
    { additionalProperties: false },
  ),
};
