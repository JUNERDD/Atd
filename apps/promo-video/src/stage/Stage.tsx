import type { ComponentType } from 'react';
import { Sequence, useCurrentFrame } from 'remotion';
import type { Lang } from '../copy.ts';
import { rasterize, type Box } from '../dots/raster.ts';
import { useFontsReady } from '../fonts.ts';
import { easeIn, mix, ramp, smoothstep } from '../motion/ease.ts';
import { springAt, type Spring } from '../motion/spring.ts';
import { cursorAt, INTRO_SPEC } from '../scenes/intro/display.ts';
import {
  CASE_IDS,
  CASE_LENGTH,
  caseStart,
  CHOREO,
  FPS,
  INTRO,
  STAGE,
  toFrames,
  type CaseId,
} from '../timeline.ts';
import { cameraAt, cameraLean } from './camera.ts';
import { Caption } from './Caption.tsx';
import { AppsCase } from './cases/AppsCase.tsx';
import { CASE_LEAD, CASE_TAIL } from './cases/case-time.ts';
import { ChatCase } from './cases/ChatCase.tsx';
import { MiniCase } from './cases/MiniCase.tsx';
import { ScreenshotCase } from './cases/ScreenshotCase.tsx';
import { SelectionCase } from './cases/SelectionCase.tsx';
import { SummonCase } from './cases/SummonCase.tsx';
import { WindowCase } from './cases/WindowCase.tsx';
import { Layer } from './Layer.tsx';
import { DESKTOP, layers, pageRows, SCENE_HEIGHT, SCENE_WIDTH } from './scene.ts';
import './stage.css';

const MORPH: Spring = { response: 0.78, damping: 0.8 };
/** The screen's corner radius, in scene pixels; stage.css draws the card with it. */
const RADIUS = 22;
/** How far the card drops as it falls back behind the features. */
const FALL = 150;

function ModelsCase() {
  return <WindowCase {...layers.settings} rows={pageRows.settings} beats={CHOREO.models} />;
}

function AutomationsCase() {
  return (
    <WindowCase
      {...layers.automations}
      rows={pageRows.automations}
      beats={CHOREO.automations}
      closes={false}
    />
  );
}

const CASES: Record<CaseId, ComponentType> = {
  summon: SummonCase,
  chat: ChatCase,
  selection: SelectionCase,
  screenshot: ScreenshotCase,
  mini: MiniCase,
  models: ModelsCase,
  apps: AppsCase,
  automations: AutomationsCase,
};

function caseSequence(id: CaseId) {
  return {
    from: toFrames(caseStart(id) - CASE_LEAD - STAGE.start),
    durationInFrames: toFrames(CASE_LENGTH + CASE_LEAD + CASE_TAIL),
  };
}

function lerpBox(from: Box, to: Box, progress: number): Box {
  return {
    x: mix(from.x, to.x, progress),
    y: mix(from.y, to.y, progress),
    width: mix(from.width, to.width, progress),
    height: mix(from.height, to.height, progress),
  };
}

/**
 * The Mac's screen as a card in space. It opens out of the display's cursor, then the camera
 * glides between the interface scenes while their captions change in the column on the left; at
 * the end the card falls back and away.
 */
export function Stage({ lang }: { lang: Lang }) {
  const t = STAGE.start + useCurrentFrame() / FPS;
  const ready = useFontsReady();
  const cursor = ready ? cursorAt(rasterize(INTRO_SPEC), INTRO.morph) : null;
  const open = springAt(t, INTRO.morph, MORPH);
  const fall = ramp(t, STAGE.exit, 0.8, easeIn);
  const shot = cameraAt(t);
  const lean = cameraLean(t);
  const scale = shot.scale * mix(0.9, 1, open) * mix(1, 0.72, fall);
  const drop = fall * FALL;
  const card: Box = {
    x: shot.x - (SCENE_WIDTH / 2) * scale,
    y: shot.y - (SCENE_HEIGHT / 2) * scale + drop,
    width: SCENE_WIDTH * scale,
    height: SCENE_HEIGHT * scale,
  };
  // While the screen opens, the card shows only the aperture growing out of the cursor.
  const aperture = cursor ? lerpBox(cursor, card, open) : card;
  const opening = open < 0.995;
  const inset = [
    aperture.y - card.y,
    card.x + card.width - aperture.x - aperture.width,
    card.y + card.height - aperture.y - aperture.height,
    aperture.x - card.x,
  ].map((edge) => `${edge / scale}px`);
  const glow = 1 - smoothstep(0.2, 0.9, open);

  return (
    <div className="scene stage">
      <div
        className="stage__light"
        style={{
          '--lx': shot.x - card.width * 0.85,
          '--ly': shot.y - card.height * 0.85 + drop,
          '--lw': card.width * 1.7,
          '--lh': card.height * 1.7,
          '--o': open * (1 - fall),
        }}
      />
      <div
        className="stage__card"
        style={{
          '--card': `translate(${shot.x - SCENE_WIDTH / 2}px, ${shot.y - SCENE_HEIGHT / 2 + drop}px) rotateY(${lean.rotateY}deg) rotateX(${lean.rotateX + fall * 22}deg) scale(${scale})`,
          '--o': 1 - fall,
          '--filter': fall > 0 ? `blur(${fall * 8}px)` : undefined,
          '--clip': opening
            ? `inset(${inset.join(' ')} round ${mix(3, RADIUS, open)}px)`
            : undefined,
        }}
      >
        <Layer layer={DESKTOP} />
        {CASE_IDS.map((id) => {
          const Case = CASES[id];
          return (
            <Sequence key={id} name={id} layout="none" {...caseSequence(id)}>
              <Case />
            </Sequence>
          );
        })}
        <div className="stage__flash" style={{ '--o': glow }} />
      </div>
      {opening ? (
        <div
          className="stage__aperture"
          style={{
            '--ax': aperture.x,
            '--ay': aperture.y,
            '--aw': aperture.width,
            '--ah': aperture.height,
            '--ar': mix(3, RADIUS * scale, open),
            '--glow': glow,
          }}
        />
      ) : null}
      <div className="stage__scrim" style={{ '--o': open * (1 - fall) }} />
      {CASE_IDS.map((id) => (
        <Sequence key={id} name={`${id} caption`} {...caseSequence(id)}>
          <Caption id={id} lang={lang} />
        </Sequence>
      ))}
    </div>
  );
}
