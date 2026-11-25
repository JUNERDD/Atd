import type { BackgroundToContent } from '../messages/content.ts';
import { ACTIVE_RUN_STATUSES, type TabView } from '../messages/views.ts';
import { watchActivity } from './activity.ts';
import { copyText } from './clipboard.ts';
import { watchFocus } from './focus.ts';
import { EdgeLight } from './glow/edge-light.ts';
import { removeLayers, removeStaleHosts, setLayersLanguage } from './hosts.ts';
import { Hud } from './hud/hud.ts';
import { currentDocumentLanguage, applyLanguage } from './i18n.ts';
import { endLifetime } from './lifetime.ts';
import { onReducedMotionChange } from './motion.ts';
import { PointerLayer } from './pointer/mark.ts';
import { ContentPort } from './port.ts';
import { SelectionCommands } from './selection/controller.ts';

/**
 * One tab's in-page surfaces, driven by the service worker's `TabView` and `PointerView` over the
 * content port: the edge light, the live pointer, the HUD with the in-page ask, and the selection
 * commands. Each surface adds its layer to the page only while it shows. The content script reads
 * nothing from the page and sends nothing until the person acts (an ask, a command on their
 * selection, a HUD control), apart from activity pings while a run owns this tab and whether focus
 * is inside a frame; the light's background sampling stays in the page.
 */
export function startContent(): void {
  removeStaleHosts();
  let tab: TabView | null = null;

  const port = new ContentPort({
    message: (message) => receive(message),
    connected: () => focus.resend(),
    invalidated: () => {
      // The extension was reloaded or removed: leave the page as it was.
      endLifetime();
      light.dispose();
      removeLayers();
    },
  });
  const send = port.send.bind(port);
  const focus = watchFocus((inFrame) => send({ type: 'focus', inFrame }));

  const light = new EdgeLight(() => hud.view.center());
  const pointerLayer = new PointerLayer();
  const hud = new Hud({
    send,
    changed: () => light.show(hud.glowMode()),
  });
  const selection = new SelectionCommands({
    send,
    ask: (quote) => hud.openAsk(quote),
    copy: copyText,
  });
  setLayersLanguage(currentDocumentLanguage());

  const runActive = () => !!tab?.run && ACTIVE_RUN_STATUSES.includes(tab.run.status);
  const frozen = () =>
    tab !== null && (tab.connection !== 'ready' || tab.run?.status === 'disconnected');
  watchActivity({
    active: runActive,
    dispatchingUntil: () => pointerLayer.dispatchingUntil,
    report: () => send({ type: 'input' }),
  });
  onReducedMotionChange(() => light.refresh());

  function apply(view: TabView): void {
    tab = view;
    if (applyLanguage(view.prefs.language)) {
      setLayersLanguage(currentDocumentLanguage());
      hud.relabel();
      selection.relabel();
      pointerLayer.relabel();
    }
    light.setEnabled(view.prefs.glowEffects);
    hud.update(view);
    selection.update(view);
    pointerLayer.setFrozen(frozen());
  }

  function receive(message: BackgroundToContent): void {
    switch (message.type) {
      case 'state':
        return apply(message.view);
      case 'pointer':
        return pointerLayer.update(message.pointer, frozen());
      case 'ask.open':
        selection.hideBar();
        return hud.openAsk(message.quote ?? null);
      case 'ask.status':
        return hud.ask.status(message);
      case 'followUp.failed':
        return hud.followUpFailed(message.taskId);
      case 'command.status':
        return selection.status(message);
    }
  }

  port.start();
}
