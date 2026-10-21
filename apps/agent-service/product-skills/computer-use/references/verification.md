# Focused verification and uncertain outcomes

Read this reference when the requested outcome lacks reliable state, observations conflict, the user requests ongoing verification, verification needs a focused native OCR region, or an action returns an uncertain result. Routine navigation and playback with reliable app-reported state use the main skill's local workflow.

## Match the condition to this action

Choose the condition before input. It proves the immediate action, not every later stage of the task. Ground input in the latest observed controls and coordinates; a condition may name the expected resulting state while that state is absent from the baseline.

An app's `textAppears` checks fresh screenshot OCR when accessibility text does not contain the expected substring, ignoring case and spacing. After the steps, an app's `textAppears` postcondition keeps reading for about three seconds while the view renders, and a `menuItemAvailable` one for about eight, since an app may relabel its menu only once the state behind it changed; other conditions are read once. Existing baseline text, compared the same way, is not evidence of a new effect, and the host refuses a submit or invoke that names it before input. Likewise, an enabled control says nothing about completion, and an already available menu item cannot prove a transition.

`menuItemAvailable` reads an exact application menu path without opening or invoking it. Native observations expose immediate application menu items through accessibility; discovery omits the system Apple menu and submenu contents. Menu items are read-only state, not element refs. Prefer app-reported state when the app exposes it; do not assume an unknown app uses a particular Play or Pause label.

When a transition takes longer than the host keeps reading, include a wait for the real resulting condition with a timeout beyond that, followed by the same postcondition. A timeout ends remaining steps and proves no success. Do not use nonexistent text as a delay. For a later observation use `observe.afterMs` (0–5000).

A read-only check still uses the complete action shape:

```json
{
  "action": "act",
  "targetRefId": "<current target>",
  "observationRefId": "<latest observation.observationRefId>",
  "steps": [
    {
      "kind": "wait",
      "condition": { "kind": "textAppears", "text": "<expected completion text>" },
      "timeoutMs": 3000
    }
  ],
  "postcondition": { "kind": "textAppears", "text": "<expected completion text>" }
}
```

This check is not a way to replace a failed action's recorded postcondition. Resolution must repeat that action's original absolute condition on the same surface.

## Focused native text verification

An element `locator` addresses one accessibility element, never an OCR box. On apps with sparse trees, verify with native `newText` without a locator; acting on observed screenshot points needs a model qualified for visual steps (`observe` reports `visual`) and a route the host offers for input to the window. It compares fresh AX/OCR text with the action's observation baseline. For a submit or invoke, give it an outcome-specific pattern or a region: the host refuses one with neither, because a rotating placeholder, a carousel or a playback timer anywhere in the window would satisfy it. A broad pattern still proves only that some text changed and needs inspection of the requested outcome.

For focused changes, add `newText.region: {capture, rect}` from the action's full observation. It is available only for attended native app actions, exclusive with `locator`, must fit the capture, and belongs to the same observed surface. Attended means an interactive user-started run rather than an automation; working in the background does not make a run unattended.

```json
{
  "kind": "newText",
  "pattern": "<outcome-specific pattern>",
  "region": {
    "capture": "<capture from this action observation>",
    "rect": { "x": 0, "y": 0, "width": 200, "height": 100 }
  }
}
```

Replace the rectangle with the actual relevant region. The host crops the existing image for the baseline and compares fresh text in the same region after input; no preparatory cropped observe is necessary. Never locate old text and expect that locator to find its replacement.

A cropped `observe` also scopes screen conditions to that crop. Its coordinates start at the crop's own top-left, and another requested rectangle must fit the reported dimensions. A full-window control outside that crop needs a fresh full observation before input. Observe with text before relying on a text baseline. `newText` is relative to that baseline; it cannot later be rebased to resolve an uncertain action.

## Playback and ongoing activity

For a request to start or stop playback, a verified transition in reliable app-reported state plus the requested track or collection in `nextObservation` is sufficient. Finish once established. A title alone does not prove playback: the track may already have been loaded, or it may have advanced automatically. Never infer play/pause icons from OCR patterns such as vertical bars, and never claim audible output from screenshots.

Use progress verification when the user requests ongoing activity checks, the app exposes no reliable playback state, or reported state conflicts with visible evidence. A static capture can reflect a covered background window that stopped redrawing; it does not establish that playback stopped. Prefer app-reported state, such as its menu items, over pixels. Nothing brings the app forward to make it redraw: when no reliable state is available, report what you can establish, or ask the person to check, instead of guessing.

For a straightforward change, one fresh baseline and a close view of an unclear control are enough preparation. Avoid repeated baseline reads or delegated pixel measurement. When switching tracks of unknown titles, use `newText.region` around the player title and controls in the current full observation, excluding changing lyrics and unrelated text. Include a short wait for the same condition. Do not assume the next title's language.

For playback without readable state, expose a readable timer or detailed player. Compare two fresh observations separated with `afterMs`; returned `nextObservation` can be the first. Keep the same track selected and compare elapsed time or the moving filled edge of its progress bar. A stationary dot, pointer or marker is not progress. Near a track's end, refresh before acting so natural advancement cannot be mistaken for the requested click. If unclear, obtain a closer fresh region. Stopping requires reliable stopped-state evidence; a single static screenshot is insufficient. Report exactly the app state or progress observed.

## Read action results honestly

`dispatch` records whether input reached the target; `effect` records what was established. A host-verified condition proves that condition, not the entire user goal. Compare relevant before/after state and distinguish visual evidence from host verification.

| Result                  | Required response                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified`              | The chosen postcondition held; compare it and fresh state with the requested outcome.                                                                                   |
| `none`                  | No effect was established; inspect dispatch and completed steps before deciding what happened.                                                                          |
| `partial` or `unknown`  | Inspect `retry` and completed steps. Never repeat an effect that may have happened; an uncertain business effect with `retry: "never"` blocks new business actions.     |
| `retry: "safe"`         | Nothing was sent; another attempt is safe after checking any stated cause.                                                                                              |
| `retry: "after_review"` | Only non-business preparation reached the target. Inspect and observe before continuing remaining steps. A successful fill followed by a refused submit did not submit. |
| `retry: "never"`        | A business step did or may have run. Never retry the effect.                                                                                                            |

An unanswered effect is uncertain too. `status` helps only when the host kept a record of an action that got no answer. Repeating the same `actionId` only returns its first result; a new id can perform the effect twice.

While a submit or invoke has an unresolved outcome with `retry: "never"` or no answer, no new submit or invoke runs on that target in this task, including later runs. A result with `after_review` only dispatched preparation: inspect and observe before continuing remaining steps without replaying completed input. Observations and other permitted non-business steps remain possible. A read-only `act` can name the original action in `resolves` only while repeating its original absolute postcondition on the same surface. Never substitute an unrelated or easier condition. Relative `newText` cannot use a later baseline. An action without a recorded condition, or with only `enabled`, needs the person to check it. A check that does not verify leaves the actions it named in `unresolved`; repeating a condition that cannot hold changes nothing, and neither do release or a new access request. Report what was attempted, what is known and what they should check; after checking, they choose Mark as checked on that action's step in the conversation, or on a step it held back, and you continue once they confirm.

A clean stale-capture refusal is different: `staleObservation`, `not_dispatched`, `none` and zero completed steps establish no input. Inspect its recovery observation, locate the control again and use a new action id; if no recovery observation exists, observe once. Never replay old coordinates automatically.

## Feedback, refusals and limits

Typing feedback is a local Settings → Computer use preference. Gradual typing and highlighting are independent of Commands settings. The host applies them to supported app fields and browser fills; unsupported fields and reduced motion use one write. The agent does not select speed, enable feedback per action, split semantic fills or add appearance-only delays. Feedback is not completion evidence.

A refused step (`noBackgroundRoute`, `targetInUse`, `needsConsent`) sent nothing: its result is `not_dispatched` with `retry: "safe"`, so it leaves no uncertain effect. Handle it as the main skill describes, then verify from fresh state. A step the person did for you is their action, not a verified one: observe the state it left and check it against the condition you would have used. A `disturbed` action did dispatch; read its `effect` and `retry` like any uncertain result, report what its `disturbances` say, and do not continue on that target until the person asks you to. A result that lists a repaired disturbance without ending in `disturbed` did not stop: continue as the main skill describes. An action the host completed in the foreground (`delivery: "foreground"`) is verified like any other; the host reads its postcondition after putting back what the person had in front of them. A declined action must not be bypassed.

Rich-text editors and canvases may accept keystrokes or capture points without exposing their result in the tree; prove the effect. A shortcut alone never establishes that a file was saved. When permissions, sign-in, a refused step or an unsupported capability blocks work, describe the smallest manual step and what you can prepare. Do not imitate an unavailable capability through another route.
