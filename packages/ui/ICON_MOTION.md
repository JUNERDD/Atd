# Icon motion

Use `useIconMotion` from `@atd/ui/lib/icon-motion` with the matching motion from
`@atd/ui/lib/icon-motions/<lucide-name>`. Continue importing the icon itself from `lucide-react`.
The controller owns playback and cleanup; the feature owns when a gesture should play.

```tsx
import { useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import { useIconMotion } from '@atd/ui/lib/icon-motion';
import { settingsMotion } from '@atd/ui/lib/icon-motions/settings';

function SectionIcon({ selected }: { selected: boolean }) {
  const icon = useRef<SVGSVGElement>(null);
  const previous = useRef(selected);
  const { play, cancel } = useIconMotion();

  useEffect(() => {
    const becameSelected = selected && !previous.current;
    previous.current = selected;
    if (becameSelected && icon.current) play(icon.current, settingsMotion);
    return cancel;
  }, [cancel, play, selected]);

  return <Settings ref={icon} aria-hidden="true" />;
}
```

## Contract

- One controller owns one active gesture. `play(svg, motion)` first cancels its previous gesture.
  Use separate controllers for independently animated icons.
- `cancel()` restores the source icon, including a completed gesture's held pose. Disabling the
  controller, changing the system reduced-motion preference, or unmounting also cancels playback.
- The hook installs no hover, focus, click, mount or looping behavior. The example above plays only
  on selection changes, skips the initial selection and does not replay when motion is re-enabled.
- Each track uses native `Keyframe[]`, a selector scoped to the supplied SVG, a duration in
  milliseconds and a CSS easing. Tracks start together and play once. `hold` retains the final pose
  until cancellation. The controller owns SVG overflow and transform-box setup and restores them.
- A track with `layer: 'overlay'` animates a temporary copy of the selected SVG geometry, normalized
  to `pathLength=1` for fractional dash lengths. It preserves the base outline. Selectors resolve
  before copies are inserted; finishing a transient track or cancelling removes its copy. `strokeTrace`
  authors a traveling highlight on this layer without hiding or redrawing the original glyph.
- Pair a motion with its matching icon explicitly. These motions address `lucide-react` 1.54.0's
  SVG structure and default stroke width. When upgrading Lucide, review those selectors and poses.
  There is no generic animation fallback for unknown icons or a name-to-icon registry.
- The settings navigation adds its own selection policy: initial render, repeated selection,
  pointer hover and keyboard focus do not play; leaving a section or replacing search rows cancels
  the outgoing gesture. Its desktop, compact and drawer layouts share that policy.

## Choreography

Each icon owns its motion file. Gestures last 640–820 ms and use a short preparation, a distinct
action and a settling phase; there are no repeated loops or whole-icon scale presets.

| Icon                | Gesture                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Settings            | Gear winds back, rotates two teeth and settles; its fixed hub carries a trace.           |
| Plug                | Body pulls away from the pins and reconnects; the cable follows with a small recoil.     |
| Shield              | Guard lifts and settles, followed by a perimeter trace and a faint interior pulse.       |
| Mouse pointer click | Pointer approaches and clicks; contact rays expand with staggered timing.                |
| Command             | Key downstroke and release, followed by highlights traveling through its four loops.     |
| Zap                 | A filled charge travels down the intact bolt, then drains downward.                      |
| Brain               | A trace travels through the stem, fork and paired outer lobes in sequence.               |
| App window          | Frame unfolds with a slight overshoot; divider and toolbar slots appear in order.        |
| Blocks              | Detached tile lifts, rotates and seats into the base; the assembled grid stays selected. |
| Info                | Dot arcs onto its stem, the stem yields, and a trace travels around the ring.            |

## Reuse decision (2026-10-26)

The closest community alternatives were checked against the existing named Lucide imports,
selection-only playback, exact cancellation and live reduced-motion changes. Context7's quota was
exhausted, so this research uses official documentation, upstream source and installed package code.

| Candidate                                                   | Evidence and fit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Animate UI](https://animate-ui.com/docs/icons/get-started) | Its current icon system offers controlled `animate`, parent triggers and reduced-motion behavior, but installs its own icon files plus `@animate-ui/react/icons`. The [reviewed repository revision](https://github.com/imskyleen/animate-ui/commit/7fffde3e56e804bcf5e580e1c13ca5bd565ef588) releases 2.3.0. Its [license](https://github.com/imskyleen/animate-ui/blob/7fffde3e56e804bcf5e580e1c13ca5bd565ef588/LICENSE.md) has Commons Clause restrictions in addition to MIT terms; it is not a plain MIT dependency.                    |
| [lucide-animated](https://lucide-animated.com/)             | An actively maintained, MIT-licensed collection built with Motion and Lucide. The [reviewed Settings component](https://github.com/pqoqubbw/icons/blob/4662fff2b60fdcf4751b32013606756caf7c4c26/icons/settings.tsx) vendors the SVG and exposes imperative start/stop handles with default hover handlers. Using it would replace direct Lucide components and still require selection and live reduced-motion integration.                                                                                                                  |
| [Motion](https://motion.dev/docs/react-use-animate)         | Already installed at 14.0.0, MIT, and supports existing SVG elements. In the [matching source](https://github.com/motiondivision/motion/blob/v14.0.0/packages/motion-dom/src/animation/NativeAnimation.ts), native animations write final inline styles on completion. Exact restoration of an already-finished icon therefore needs additional integration; `cancel()` alone does not remove those committed styles. Its installed `useReducedMotion` also reads React state only at mount, so live preference changes need a subscription. |

For these finite gestures, use the browser's [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)
directly. Native [cancellation removes animation effects](https://developer.mozilla.org/en-US/docs/Web/API/Animation/cancel),
including held end poses, while preserving the original Lucide SVG. This requires no new dependency,
vendored SVG definitions, timers or animation engine. Custom code is limited to icon-specific choreography,
React lifecycle cleanup and the media-query subscription. Existing Motion usage elsewhere is unchanged.

The remaining custom boundary is deliberate: a new icon needs a gesture designed for its geometry;
the controller is reusable, but it cannot infer a meaningful gesture from an arbitrary SVG.
