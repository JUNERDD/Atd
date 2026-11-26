import type { EdgeLight } from './glow/edge-light.ts';
import type { GlowMode } from './hud/hud.ts';
import { reducedMotion } from './motion.ts';
import type { PageTransitions, TransitionKind } from './transition/transitions.ts';

export interface RunEdgesDeps {
  light: EdgeLight;
  transitions: PageTransitions;
  /** The person's glow effects setting. */
  effects(): boolean;
  /** The HUD's box in viewport CSS px (where it would show when it does not). */
  hudBounds(): DOMRectReadOnly;
  /** Everything the HUD draws right now, morphs included, while it draws anything. */
  hudDrawn(): DOMRectReadOnly | null;
  /** The live pointer's box in viewport CSS px while it shows. */
  pointerBounds(): DOMRectReadOnly | null;
}

/** A mask slot whose surface is not shown. */
const NONE = new DOMRect();

/**
 * The light follows the HUD's state, and the run's two edges in the tab each get a page
 * transition out of the HUD's centre (`transition/`): the ripple when the light comes on as a run
 * takes the tab, the sweep at done. Atd's own surfaces are in the captured frame, so the HUD and
 * the pointer are masked out of it: all the HUD draws, not only the box it rests in, since a run
 * starting or ending captures it mid-morph (the composer shrinking into the run's row) and the
 * frozen shape would otherwise show beside the live one. The light comes on at once: the ripple's
 * frame is captured with its entry barely begun, beside the HUD and under its mask. At done the
 * light is in the sweep's frame too, so once that frame covers the page the live light leaves at
 * once (`EdgeLight.handOff`) and the sweep carries the frozen one away, instead of the two drawing
 * over each other. Neither transition plays with glow effects off or under Reduce Motion, nor when
 * one cannot (`PageTransitions.play`): the light then does what it does alone.
 */
export class RunEdges {
  /** The last mode followed: the HUD renders often, and only a change of mode is an edge. */
  private mode: GlowMode = 'off';

  constructor(private readonly deps: RunEdgesDeps) {}

  /** The HUD rendered (`Hud.glowMode`). */
  follow(mode: GlowMode): void {
    const { light } = this.deps;
    const wasLit = light.lit;
    const changed = mode !== this.mode;
    this.mode = mode;
    light.show(mode);
    if (!changed || !this.deps.effects() || reducedMotion()) return;
    if (!wasLit && light.lit && (mode === 'working' || mode === 'attention')) {
      this.play('ripple');
    } else if (wasLit && mode === 'done') {
      this.play('sweep', () => light.handOff());
    }
  }

  private play(kind: TransitionKind, covered?: () => void): void {
    const { deps } = this;
    void deps.transitions.play(kind, {
      origin: () => {
        const box = deps.hudBounds();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      },
      darkness: deps.light.sampledDarkness,
      masks: () => [deps.hudDrawn() ?? NONE, deps.pointerBounds() ?? NONE],
      ...(covered ? { covered } : {}),
    });
  }
}
