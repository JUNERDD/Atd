import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { PanelView } from '../agent/use-task-panel';
import { PanelModal, type PanelModalDeckItem } from './panel-modal';
import { PANEL_MODAL_DEFINITIONS } from './panel-modal-registry';
import { usePanelModals } from './use-panel-modals';

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Hosts eligible or manually reopened main-panel modals inside the shared carousel dialog shell,
 * retaining the last open slide deck briefly across exit animations so Radix Dialog can transition
 * `[data-state='closed']` cleanly before unmounting.
 */
export function PanelModalHost({
  snapshot,
  view,
  ready = true,
}: {
  snapshot: SettingsSnapshot | null;
  view: PanelView;
  ready?: boolean;
}) {
  const { t } = useTranslation('panel');
  const {
    isOpen,
    sessionKey,
    initialIndex,
    activeItems,
    markSlideViewed,
    dismissSlide,
    completeSlide,
    dismissAll,
  } = usePanelModals(PANEL_MODAL_DEFINITIONS, snapshot, view, ready);

  const [cachedDeck, setCachedDeck] = useState<{
    ids: string[];
    sessionKey: number;
    initialIndex: number;
  } | null>(null);
  const [cachedSnapshot, setCachedSnapshot] = useState<SettingsSnapshot | null>(null);

  if (snapshot && snapshot !== cachedSnapshot) {
    setCachedSnapshot(snapshot);
  }

  const activeIds = activeItems.map((item) => item.definition.id);
  if (
    isOpen &&
    activeIds.length > 0 &&
    (!cachedDeck ||
      cachedDeck.sessionKey !== sessionKey ||
      !sameIds(cachedDeck.ids, activeIds) ||
      cachedDeck.initialIndex !== initialIndex)
  ) {
    setCachedDeck({ ids: activeIds, sessionKey, initialIndex });
  }

  // Unmount the retained dialog once its exit animation window finishes so closed modals never
  // keep a hidden Radix Portal/Presence alive if WebKit drops animationend.
  useEffect(() => {
    if (isOpen || (cachedDeck === null && cachedSnapshot === null)) return;
    const timer = window.setTimeout(() => {
      setCachedDeck(null);
      setCachedSnapshot(null);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [isOpen, cachedDeck, cachedSnapshot]);

  const renderSnapshot = snapshot ?? cachedSnapshot;
  const renderedDefinitions = isOpen
    ? activeItems.map((item) => item.definition)
    : (cachedDeck?.ids ?? []).flatMap((id) => {
        const match = PANEL_MODAL_DEFINITIONS.find((def) => def.id === id);
        return match ? [match] : [];
      });

  if (!renderSnapshot || renderedDefinitions.length === 0) {
    return null;
  }

  const deckItems: PanelModalDeckItem[] = renderedDefinitions.map((definition) => ({
    id: definition.id,
    hasMedia: definition.hasMedia,
    content: definition.render({
      active: isOpen,
      snapshot: renderSnapshot,
      onDismiss: () => dismissSlide(definition.id),
      onComplete: () => completeSlide(definition.id),
    }),
  }));

  return (
    <PanelModal
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) dismissAll();
      }}
      items={deckItems}
      sessionKey={isOpen ? sessionKey : (cachedDeck?.sessionKey ?? 0)}
      initialIndex={isOpen ? initialIndex : (cachedDeck?.initialIndex ?? 0)}
      onActiveIndexChange={isOpen ? markSlideViewed : undefined}
      closeLabel={t('modals.close')}
    />
  );
}
