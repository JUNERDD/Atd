/**
 * The Mac the film demonstrates on: the website's interface scenes, cut from Figma into layers that
 * stack over one shared desktop (apps/website/public/cases/README.md). Each layer is a 2x image of
 * its box on the 1440 × 900 scene; the boxes are the website's generated `case-layers.css`, in
 * scene pixels. The images are read from the website's public folder, the one place they live.
 */
import desktop from '../../../website/public/cases/layers/desktop.webp';
import appsList from '../../../website/public/cases/layers/apps/1-apps.webp';
import appsNotes from '../../../website/public/cases/layers/apps/2-notes.webp';
import autoWindow from '../../../website/public/cases/layers/automations/1-window.webp';
import autoPage from '../../../website/public/cases/layers/automations/2-page.webp';
import chatPanel from '../../../website/public/cases/layers/chat/1-panel.webp';
import chatEarlier from '../../../website/public/cases/layers/chat/2-earlier.webp';
import chatAsk from '../../../website/public/cases/layers/chat/3-ask.webp';
import chatStatus from '../../../website/public/cases/layers/chat/4-status.webp';
import chatTools from '../../../website/public/cases/layers/chat/5-tools.webp';
import chatAnswer from '../../../website/public/cases/layers/chat/6-answer.webp';
import chatActions from '../../../website/public/cases/layers/chat/7-actions.webp';
import mainPanel from '../../../website/public/cases/layers/main-panel/1-panel.webp';
import mainWelcome from '../../../website/public/cases/layers/main-panel/2-welcome.webp';
import miniFlyout from '../../../website/public/cases/layers/mini-panel/1-flyout.webp';
import miniRail from '../../../website/public/cases/layers/mini-panel/2-rail.webp';
import miniPointer from '../../../website/public/cases/layers/mini-panel/3-pointer.webp';
import shotWindows from '../../../website/public/cases/layers/screenshot/1-windows.webp';
import shotDim from '../../../website/public/cases/layers/screenshot/2-dim.webp';
import shotMosaic from '../../../website/public/cases/layers/screenshot/3-mosaic.webp';
import shotStep1 from '../../../website/public/cases/layers/screenshot/4-step-1.webp';
import shotStep2 from '../../../website/public/cases/layers/screenshot/5-step-2.webp';
import shotStep3 from '../../../website/public/cases/layers/screenshot/6-step-3.webp';
import shotSelection from '../../../website/public/cases/layers/screenshot/7-selection.webp';
import shotBars from '../../../website/public/cases/layers/screenshot/8-bars.webp';
import shotHint from '../../../website/public/cases/layers/screenshot/9-hint.webp';
import selPage from '../../../website/public/cases/layers/selection-toolbar/1-page.webp';
import selHighlight from '../../../website/public/cases/layers/selection-toolbar/2-highlight.webp';
import selText from '../../../website/public/cases/layers/selection-toolbar/3-text.webp';
import selToolbar from '../../../website/public/cases/layers/selection-toolbar/4-toolbar.webp';
import settingsWindow from '../../../website/public/cases/layers/settings/1-window.webp';
import settingsPage from '../../../website/public/cases/layers/settings/2-page.webp';

export const SCENE_WIDTH = 1440;
export const SCENE_HEIGHT = 900;

export interface SceneLayer {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function layer(src: string, x: number, y: number, width: number, height: number): SceneLayer {
  return { src, x, y, width, height };
}

export const DESKTOP = layer(desktop, 0, 0, SCENE_WIDTH, SCENE_HEIGHT);

export const layers = {
  main: {
    panel: layer(mainPanel, 883, 101, 557, 762),
    welcome: layer(mainWelcome, 939, 245, 232, 51),
  },
  chat: {
    panel: layer(chatPanel, 883, 101, 557, 762),
    earlier: layer(chatEarlier, 940, 187, 468, 166),
    ask: layer(chatAsk, 1102, 377, 306, 70),
    status: layer(chatStatus, 940, 500, 468, 24),
    tools: layer(chatTools, 940, 543, 463, 17),
    answer: layer(chatAnswer, 940, 584, 366, 64),
    actions: layer(chatActions, 946, 668, 144, 18),
  },
  selection: {
    page: layer(selPage, 439, 339, 562, 222),
    highlight: layer(selHighlight, 579, 457, 282, 24),
    text: layer(selText, 479, 461, 467, 39),
    toolbar: layer(selToolbar, 521, 400, 398, 80),
  },
  screenshot: {
    windows: layer(shotWindows, 79, 67, 1322, 732),
    dim: layer(shotDim, 0, 0, SCENE_WIDTH, SCENE_HEIGHT),
    mosaic: layer(shotMosaic, 375, 495, 218, 26),
    step1: layer(shotStep1, 577, 177, 30, 30),
    step2: layer(shotStep2, 791, 197, 54, 74),
    step3: layer(shotStep3, 359, 515, 443, 86),
    selection: layer(shotSelection, 354, 120, 532, 486),
    bars: layer(shotBars, 331, 594, 569, 130),
    hint: layer(shotHint, 526, 847, 388, 26),
  },
  mini: {
    flyout: layer(miniFlyout, 1075, 247, 330, 231),
    rail: layer(miniRail, 1363, 236, 77, 244),
    pointer: layer(miniPointer, 1184, 313, 18, 22),
  },
  settings: {
    window: layer(settingsWindow, 179, 61, 1082, 802),
    page: layer(settingsPage, 454, 139, 767, 670),
  },
  apps: {
    list: layer(appsList, 59, 133, 502, 662),
    notes: layer(appsNotes, 579, 113, 802, 694),
  },
  automations: {
    window: layer(autoWindow, 179, 61, 1082, 802),
    page: layer(autoPage, 454, 139, 767, 670),
  },
} as const;

/**
 * Where a page layer splits into rows, in its own pixels (scene units from the layer's top), so a
 * list can arrive a row at a time over its empty window. The page carries a 10% tint over its whole
 * box, so the rows tile it from top to bottom with no gaps; the last runs to the bottom edge.
 */
export const pageRows = {
  settings: [0, 41, 85, 170, 252, 334, 670],
  automations: [0, 41, 85, 188, 288, 388, 488, 670],
} as const satisfies Record<string, readonly number[]>;
