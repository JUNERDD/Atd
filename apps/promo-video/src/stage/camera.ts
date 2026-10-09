/**
 * The camera on the Mac's screen. A shot places the screen card in the frame (its center and its
 * scale); the camera springs from shot to shot, each new spring blending from wherever the last one
 * is, so moves chain without a jolt. The card leans into its own motion, as a held camera would.
 */
import { springAt, type Spring } from '../motion/spring.ts';
import { caseStart, STAGE, type CaseId } from '../timeline.ts';
import { SCENE_HEIGHT, SCENE_WIDTH } from './scene.ts';

export interface Shot {
  /** Where the card's center sits in the frame. */
  x: number;
  y: number;
  scale: number;
}

/** Places scene point (sceneX, sceneY) at frame point (frameX, frameY), at `scale`. */
export function frameOn(
  sceneX: number,
  sceneY: number,
  scale: number,
  frameX: number,
  frameY: number,
): Shot {
  return {
    x: frameX + (SCENE_WIDTH / 2 - sceneX) * scale,
    y: frameY + (SCENE_HEIGHT / 2 - sceneY) * scale,
    scale,
  };
}

/** The whole Mac, right of the captions: where the screen opens. */
export const BASE = frameOn(720, 450, 0.86, 1201, 540);

const MOVE: Spring = { response: 1.05, damping: 0.9 };
/** The slow push-in while a scene plays. */
const DRIFT: Spring = { response: 4.2, damping: 1 };

/** Each case's opening shot, and the gentle push it drifts into. */
const SHOTS: Record<CaseId, { arrive: Shot; drift: Shot }> = {
  summon: { arrive: frameOn(720, 450, 0.92, 1178, 548), drift: frameOn(780, 450, 0.96, 1190, 548) },
  chat: { arrive: frameOn(1161, 482, 1.06, 1430, 552), drift: frameOn(1161, 482, 1.1, 1422, 552) },
  selection: {
    arrive: frameOn(720, 452, 1.8, 1296, 552),
    drift: frameOn(720, 452, 1.88, 1300, 552),
  },
  screenshot: {
    arrive: frameOn(740, 432, 0.92, 1222, 540),
    drift: frameOn(700, 400, 0.98, 1214, 540),
  },
  mini: { arrive: frameOn(1258, 356, 1.62, 1370, 540), drift: frameOn(1258, 356, 1.7, 1370, 540) },
  models: { arrive: frameOn(720, 462, 0.93, 1214, 548), drift: frameOn(760, 420, 1, 1222, 548) },
  apps: { arrive: frameOn(720, 454, 0.9, 1208, 540), drift: frameOn(720, 454, 0.95, 1208, 540) },
  automations: {
    arrive: frameOn(760, 470, 0.96, 1222, 548),
    drift: frameOn(790, 440, 1.02, 1226, 548),
  },
};

interface Key {
  at: number;
  shot: Shot;
  spring: Spring;
}

const KEYS: Key[] = [
  { at: STAGE.start, shot: BASE, spring: MOVE },
  ...(Object.entries(SHOTS) as [CaseId, (typeof SHOTS)[CaseId]][]).flatMap(([id, shots]) => [
    { at: caseStart(id) - 0.05, shot: shots.arrive, spring: MOVE },
    { at: caseStart(id) + 1.1, shot: shots.drift, spring: DRIFT },
  ]),
];

function blend(from: Shot, to: Shot, progress: number): Shot {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    scale: from.scale + (to.scale - from.scale) * progress,
  };
}

export function cameraAt(t: number): Shot {
  let shot = BASE;
  for (const key of KEYS) {
    const progress = springAt(t, key.at, key.spring);
    if (progress === 0) break;
    shot = blend(shot, key.shot, progress);
  }
  return shot;
}

/** The lean, in degrees: the card turns a little into horizontal moves and tips with vertical ones. */
export function cameraLean(t: number): { rotateX: number; rotateY: number } {
  const dt = 1 / 120;
  const before = cameraAt(t - dt);
  const after = cameraAt(t + dt);
  const vx = (after.x - before.x) / (2 * dt);
  const vy = (after.y - before.y) / (2 * dt);
  const clampDeg = (value: number) => Math.max(-7, Math.min(7, value));
  return { rotateY: clampDeg(vx * 0.0055), rotateX: clampDeg(-vy * 0.0055) };
}
