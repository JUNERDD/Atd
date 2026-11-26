import type { BackgroundToContent } from '../messages/content.ts';
import { ACTIVE_RUN_STATUSES, type TabView } from '../messages/views.ts';
import { watchActivity } from './activity.ts';
import { EdgeLight } from './glow/edge-light.ts';
import { removeLayers, removeStaleHosts, setLayersLanguage } from './hosts.ts';
import { Hud } from './hud/hud.ts';
import { currentDocumentLanguage, applyLanguage } from './i18n.ts';
import { endLifetime } from './lifetime.ts';
import { onReducedMotionChange } from './motion.ts';
import { PointerLayer } from './pointer/mark.ts';
import { ContentPort } from './port.ts';
import { RunEdges } from './run-edges.ts';
import { PageTransitions } from './transition/transitions.ts';

/**
 * One tab's in-page surfaces, driven by the service worker's `TabView` and `PointerView` over the
 * content port: the edge light with the page transitions at a run's start and end, the live
 * pointer, and the HUD with the in-page ask. Each surface adds its layer to the page only while it
 * shows. The content script reads nothing from the page and sends nothing until the person acts
 * (an ask, a HUD control), apart from activity pings while a run owns this tab and the capture
 * requests its page transitions make; the light's background sampling stays in the page. Commands
 * on selected text are Atd's own selection toolbar, not the extension's.
 */
export function startContent(): void {
  removeStaleHosts();
  let tab: TabView | null = null;

  const port = new ContentPort({
    message: (message) => receive(message),
    invalidated: () => {
      // The extension was reloaded or removed: leave the page as it was.
      endLifetime();
      light.dispose();
      transitions.dispose();
      removeLayers();
    },
  });
  const send = port.send.bind(port);

  const light = new EdgeLight(() => hud.view.bounds());
  const pointerLayer = new PointerLayer((at) => light.click(at.x, at.y));
  const transitions = new PageTransitions({ send });
  const edges = new RunEdges({
    light,
    transitions,
    effects: () => tab?.prefs.glowEffects ?? true,
    hudBounds: () => hud.view.bounds(),
    hudDrawn: () => hud.view.drawnBounds(),
    pointerBounds: () => pointerLayer.bounds(),
  });
  const runActive = () => !!tab?.run && ACTIVE_RUN_STATUSES.includes(tab.run.status);
  const frozen = () =>
    tab !== null && (tab.connection !== 'ready' || tab.run?.status === 'disconnected');
  const activity = watchActivity({
    active: runActive,
    dispatchingUntil: () => pointerLayer.dispatchingUntil,
    ownEvent: (event) => hud.view.isMoveShortcut(event),
    report: () => send({ type: 'input' }),
  });
  const hud = new Hud({
    send,
    takeOwnInput: () => activity.takeOwnInput(),
    changed: () => edges.follow(hud.glowMode()),
  });
  setLayersLanguage(currentDocumentLanguage());
  onReducedMotionChange(() => light.refresh());

  function apply(view: TabView): void {
    tab = view;
    if (applyLanguage(view.prefs.language)) {
      setLayersLanguage(currentDocumentLanguage());
      hud.relabel();
      pointerLayer.relabel();
    }
    light.setEnabled(view.prefs.glowEffects);
    hud.update(view);
    pointerLayer.setFrozen(frozen());
  }

  function receive(message: BackgroundToContent): void {
    switch (message.type) {
      case 'state':
        return apply(message.view);
      case 'pointer':
        return pointerLayer.update(message.pointer, frozen());
      case 'ask.open':
        return hud.openAsk();
      case 'ask.status':
        return hud.ask.status(message);
      case 'followUp.failed':
        return hud.followUpFailed(message.taskId);
      case 'transition.frame':
        return transitions.receive(message);
    }
  }

  port.start();
}
