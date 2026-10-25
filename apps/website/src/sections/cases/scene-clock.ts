/**
 * The share of a scene's step that plays its choreography; the rest holds the finished scene, so it
 * reads complete for a moment before the next scene cross-fades in.
 */
export const PLAY = 0.85;

/**
 * Seeks each scene's choreography by scroll instead of by time. scenes.css declares every layer's
 * entrance as a paused CSS animation (under the showcase's `data-scrub`), so the stylesheet stays
 * the one source of the timing; this reads those animations back and sets their time from how far
 * the scene's step has scrolled. A scene's length is its latest animation end, so a longer
 * choreography plays over the same step at a finer grain. Filled end states keep completed CSS
 * animations collectable for reverse scrubbing after more scenes have been rendered.
 */
export function createSceneClock(slides: readonly HTMLElement[]) {
  let scenes: { animations: Animation[]; length: number }[] = [];

  /** Reads the scenes' animations again: after the scrub is enabled or the motion preference changes. */
  function collect() {
    scenes = slides.map((slide) => {
      // The slide's opacity cross-fade follows selection, independently of layer choreography.
      const animations = Array.from(slide.querySelectorAll<HTMLElement>('.cases__layer')).flatMap(
        (layer) => layer.getAnimations(),
      );
      const ends = animations.map((animation) => animation.effect?.getComputedTiming().endTime);
      const length = Math.max(0, ...ends.map((end) => (typeof end === 'number' ? end : 0)));
      return { animations, length };
    });
  }

  /** Shows scene `index` at `progress` (0–1) through its step. */
  function seek(index: number, progress: number) {
    const scene = scenes[index];
    if (!scene) return;
    const time = Math.min(1, Math.max(0, progress) / PLAY) * scene.length;
    for (const animation of scene.animations) {
      if (animation.currentTime !== time) animation.currentTime = time;
    }
  }

  return { collect, seek };
}
