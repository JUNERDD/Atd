import { lazyWithPreload } from '../../lib/lazy-with-preload';
import { preloadPanelModals } from '../panel-modals/panel-modal-registry';
import type { PanelView } from './use-task-panel';
import { preloadGlowField } from './waiting-glow/glow-field-loader';

const taskStage = lazyWithPreload(() => import('./task-stage').then((module) => module.TaskStage));
const taskHistory = lazyWithPreload(() =>
  import('./task-history').then((module) => module.TaskHistory),
);
const appsView = lazyWithPreload(() =>
  import('../apps/apps-view').then((module) => module.AppsView),
);
const commandInput = lazyWithPreload(() =>
  import('./command-input').then((module) => module.CommandInput),
);

export const TaskStage = taskStage.Component;
export const TaskHistory = taskHistory.Component;
export const AppsView = appsView.Component;
export const CommandInput = commandInput.Component;

const viewPreloaders: Partial<Record<PanelView, () => Promise<unknown>>> = {
  task: taskStage.preload,
  history: taskHistory.preload,
  apps: appsView.preload,
  input: commandInput.preload,
};

/** Loads a non-welcome panel view chunk if it has not been requested yet. */
export async function loadPanelView(view: PanelView): Promise<void> {
  await viewPreloaders[view]?.();
}

/** Begins loading a non-welcome panel view chunk if it has not been requested yet. */
export function preloadPanelView(view: PanelView): void {
  void loadPanelView(view);
}

/** Loads all code-split panel views for synchronous view transitions in tests and warmups. */
export async function preloadAllPanelViews(): Promise<void> {
  await Promise.all([
    taskStage.preload(),
    taskHistory.preload(),
    appsView.preload(),
    commandInput.preload(),
  ]);
}

/**
 * Warms deferred panel chunks (transcript stage, markdown, code-highlight workers, task history,
 * waiting glow, and modal chrome) once the welcome frame has settled so they never contend with
 * the initial render.
 */
export function warmPanelDeferredChunks(): void {
  void taskStage.preload();
  void taskHistory.preload();
  void commandInput.preload();
  void preloadGlowField();
  void preloadPanelModals();
  void import('./transcript/markdown-loader').then(({ loadMarkdown }) => loadMarkdown());
  void import('./transcript/code-highlight-pool-singleton').then(({ warmCodeHighlightPool }) =>
    warmCodeHighlightPool(),
  );
}
