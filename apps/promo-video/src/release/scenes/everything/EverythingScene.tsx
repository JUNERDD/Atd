import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Lang } from '../../../copy.ts';
import { useFontsReady } from '../../../fonts.ts';
import { Camera } from '../../../kit/world/Camera.tsx';
import { cameraAt } from '../../../kit/world/camera.ts';
import { textUnits } from '../../../kit/world/text-units.ts';
import { releaseCopy } from '../../copy.ts';
import { Caret } from '../../world/Caret.tsx';
import { DotField } from '../../world/DotField.tsx';
import { Statement } from '../../world/Statement.tsx';
import { FINALE_ENTRY } from '../finale/beats.ts';
import { EVERYTHING_BEATS as B } from './beats.ts';
import { SHOTS, TILES } from './layout.ts';
import {
  caretGlow,
  dotsOpacity,
  fieldClock,
  fieldPulses,
  fieldViewAt,
  morphAt,
  toScreen,
} from './motion.ts';
import { Mosaic } from './Mosaic.tsx';
import './everything.css';

const POINT = TILES.find((tile) => tile.kind === 'point')!.rect;

/** The word of the lead line set in coral: "everything" / 「一切」. */
function accentIndex(text: string, lang: Lang): number {
  return textUnits(text, lang).findIndex((unit) => /everything|一切/.test(unit.text));
}

/**
 * Everything Atd already does. Out of the bare grid the lead line rises on the eighths while the
 * camera dives in; the dots swell into tiles of live product vignettes, the heroes landing every
 * three eighths with their words (Tasks · Apps · Automations · Memory · Skills · Subagents · MCP ·
 * Capture) as the camera whips from one to the next. On bar 21 it pulls back: the tiles spell
 * "0.8", the coral point lands last, a glint crosses it, the point rises into the caret and every
 * tile pours into it, ending on the finale's first frame: the bare field and its caret.
 */
export function EverythingScene({ lang }: { lang: Lang }) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const copy = releaseCopy[lang].everything;
  const cam = cameraAt(t, SHOTS);
  const clock = fieldClock(t);
  const view = fieldViewAt(t, cam);
  const speed = Math.hypot(cam.vx, cam.vy) * cam.zoom;
  const streak =
    speed > 900 && t < B.swallowed
      ? { x: (cam.vx * view.zoom) / 240, y: (cam.vy * view.zoom) / 240 }
      : undefined;
  const pointOnScreen = (() => {
    const a = toScreen(cam, POINT.x, POINT.y);
    return { ...a, width: POINT.width * cam.zoom, height: POINT.height * cam.zoom };
  })();
  const stretching = t >= B.morph && t < B.morph + B.morphLength;
  const morph = morphAt(t, pointOnScreen);
  return (
    <AbsoluteFill className="scene r08 r08-every">
      <DotField
        t={clock.t}
        view={view}
        drift={0}
        twinkle={clock.twinkle}
        pulses={fieldPulses(t, cam, view)}
        opacity={dotsOpacity(t)}
        {...(streak ? { streak } : {})}
      />
      {t < B.swallowed ? (
        <Camera state={cam}>
          <Mosaic lang={lang} t={t} cam={cam} />
        </Camera>
      ) : null}
      {t > B.lead[0] - 0.05 && t < B.leadOut + 0.5 ? (
        <div className="r08-every__lead">
          <Statement
            t={t}
            lang={lang}
            text={copy.lead}
            at={B.lead[0]}
            times={B.lead}
            accent={[accentIndex(copy.lead, lang)]}
            out={B.leadOut}
          />
        </div>
      ) : null}
      {stretching ? (
        <div
          className="r08-every__morph"
          style={{
            '--ev-x': morph.x,
            '--ev-y': morph.y,
            '--ev-w': morph.width,
            '--ev-h': morph.height,
            '--ev-r': morph.radius,
            '--ev-glow': 1,
          }}
        />
      ) : null}
      {t >= B.morph + B.morphLength ? (
        <Caret
          t={0}
          solid
          x={FINALE_ENTRY.x}
          y={FINALE_ENTRY.y}
          height={FINALE_ENTRY.height}
          {...(t >= B.swallowed ? {} : { glow: caretGlow(t) })}
        />
      ) : null}
    </AbsoluteFill>
  );
}
