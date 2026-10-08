import type { cases } from '../../content/cases';

export type CaseId = (typeof cases)[number]['id'];

interface SceneTiming {
  /** How long the scene holds during playback, in milliseconds. */
  duration: number;
}

/** Each scene's hold: its entrance in scenes.css, then about a second to take it in. */
export const sceneTiming = {
  'selection-toolbar': { duration: 4000 },
  'mini-panel': { duration: 3500 },
  screenshot: { duration: 5000 },
  'main-panel': { duration: 3000 },
  chat: { duration: 4500 },
  settings: { duration: 3000 },
  apps: { duration: 3500 },
  automations: { duration: 3000 },
} satisfies Record<CaseId, SceneTiming>;
