import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { copy, type Lang } from '../../copy.ts';
import { useFontsReady } from '../../fonts.ts';
import { Camera } from '../../kit/world/Camera.tsx';
import { cameraAt } from '../../kit/world/camera.ts';
import { Caption } from '../../kit/world/Caption.tsx';
import { ChapterTitle } from '../../kit/world/ChapterTitle.tsx';
import { Cursor } from '../../kit/world/Cursor.tsx';
import { cursorAt } from '../../kit/world/cursor.ts';
import { Desktop } from '../../kit/world/Desktop.tsx';
import { Light } from '../../kit/world/Light.tsx';
import { blendMoods } from '../../kit/world/light-field.ts';
import { easeInOut, easeOut, mix, ramp } from '../../motion/ease.ts';
import { springAt, springs } from '../../motion/spring.ts';
import { AppLayer } from './AppLayer.tsx';
import {
  APP,
  CURSOR,
  cursorOpacity,
  FLY,
  PANEL,
  SHOTS,
  TOOLS,
  toolsShake,
  WORK,
  drift,
} from './beats.ts';
import { TaskPanel } from './TaskPanel.tsx';
import { ToolsBeat } from './ToolsBeat.tsx';
import './anything.css';

/**
 * The camera streaks only on its whip into the defocused desktop behind the cards; its pushes and
 * pull-backs on the panel stay sharp, so the interface reads through every move.
 */
function whipping(t: number): boolean {
  return t >= TOOLS.start - 0.15 && t < TOOLS.start + 0.7;
}

/** Atd's status item: its running badge while either request is being worked on. */
function statusBadge(t: number): number {
  const [, , , , done] = WORK.todos;
  return (
    springAt(t, WORK.send, springs.pop) * (1 - ramp(t, done, 0.25)) +
    springAt(t, APP.send, springs.pop) * (1 - ramp(t, APP.built, 0.25))
  );
}

/**
 * Anything (24–42 s): the chapter word, then a real task worked end to end in a macro of the
 * panel (plan, subagents, tool calls, an approval, the answer and its file), a habit tracker built,
 * opened onto the desktop and pinned, and three tools the agent makes on request, slamming in on
 * the beat. The camera pulls back with the last of them into the dusk Anytime opens on.
 */
export function Anything({ lang }: { lang: Lang }) {
  useFontsReady();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const film = copy[lang].anything;
  const shot = cameraAt(t, SHOTS);
  const sway = drift(t);
  const camera = { ...shot, x: shot.x + sway.x, y: shot.y + sway.y };
  const cursor = cursorAt(t, CURSOR);
  const badge = statusBadge(t);

  // The world arrives through the word and leaves as the camera pulls back into the dusk.
  const worldIn = ramp(t, FLY - 0.02, 0.4, easeOut);
  const worldOut = ramp(t, TOOLS.pullOut + 0.05, 0.6, easeInOut);
  const scrim = ramp(t, TOOLS.start - 0.05, 0.3) * (1 - worldOut);
  // The light behind the title keeps the dive's momentum, and turns to dusk for the hand-off.
  const settle = ramp(t, 0, 1.3, easeOut);
  const pass = ramp(t, FLY, 0.6, easeOut);
  const back = ramp(t, TOOLS.pullOut, 1, easeOut);

  return (
    <AbsoluteFill className="scene anything" lang={lang}>
      <div
        className="anything-light"
        style={{ '--s': mix(1.14, 1, settle) + pass * 0.3 * (1 - back) }}
      >
        <Light
          t={t + 3}
          mood={blendMoods('bright', 'dusk', ramp(t, TOOLS.pullOut - 0.4, 1.2, easeInOut))}
          intensity={mix(0.72, 1, springAt(t, 0, springs.smooth))}
        />
      </div>
      <div className="anything-stage" style={{ '--shake': `${toolsShake(t)}px` }}>
        {worldIn > 0 && worldOut < 1 && (
          <div className="anything-world" style={{ '--o': worldIn * (1 - worldOut) }}>
            <Camera state={camera} motionBlur={whipping(t)}>
              <Desktop
                lang={lang}
                t={t}
                status={badge > 0.01 ? 'running' : 'idle'}
                statusBadge={badge}
              >
                <div className="anything-at" style={{ '--x': PANEL.x, '--y': PANEL.y }}>
                  <TaskPanel lang={lang} t={t} />
                </div>
                <AppLayer lang={lang} t={t} cursor={cursor} />
                <Cursor state={cursor} opacity={cursorOpacity(t)} />
              </Desktop>
            </Camera>
            <div className="anything-scrim" style={{ '--o': scrim }} />
          </div>
        )}
        <ToolsBeat lang={lang} t={t} />
      </div>
      {t < FLY + 0.6 && (
        <ChapterTitle t={t} word={film.chapter.word} subline={film.chapter.subline} lang={lang} />
      )}
      <div data-caption="beside-panel">
        <Caption t={t} in={WORK.plan} out={APP.start - 0.4} text={film.work} lang={lang} />
      </div>
      <Caption t={t} in={APP.build} out={TOOLS.start - 0.15} text={film.app} lang={lang} />
      <Caption t={t} in={TOOLS.cards[0]} out={TOOLS.pullOut - 0.15} text={film.tools} lang={lang} />
    </AbsoluteFill>
  );
}
