import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { useSettingsNavigation } from '../settings/settings-navigation';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';

/**
 * How many memories are saved, from the Memory section's own source (the agent bridge), kept
 * current by its change events. Null until it is read, or where there is no agent bridge.
 */
function useMemoryEntryCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const agent = window.desktop?.agent;
    if (!agent) return;
    let active = true;
    const off = agent.onChange((event) => {
      if (event.type === 'memory') setCount(event.snapshot.entries.length);
    });
    agent.memory().then(
      (snapshot) => {
        if (active) setCount(snapshot.entries.length);
      },
      () => undefined,
    );
    return () => {
      active = false;
      off();
    };
  }, []);
  return count;
}

/**
 * Personal's memory. Memory has one authority, managed in the Memory section, so this group only
 * counts its entries, links there, and carries the learning switch, which is the memory item's
 * switch: turning it off pauses learning.
 */
export function PluginMemoryGroup({
  learning,
  disabled,
  onLearningChange,
  showTitle = true,
}: {
  learning: boolean;
  disabled: boolean;
  onLearningChange: (learning: boolean) => void;
  /** False when a tab names the kind; the section keeps its name for accessibility. */
  showTitle?: boolean;
}) {
  const { t } = useTranslation('settings');
  const navigate = useSettingsNavigation();
  const entries = useMemoryEntryCount();
  const title = t('extensions.plugins.kinds.memory');
  const open = () => navigate('memory');
  const description = [
    entries === null ? '' : t('extensions.plugins.page.memoryEntries', { count: entries }),
    learning ? t('extensions.plugins.page.learningOn') : t('extensions.plugins.page.learningOff'),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <ExtensionGroup title={title} empty="" loading={false} hasRows showTitle={showTitle}>
      <ExtensionRow name={title} onDetails={open}>
        <ItemMedia variant="icon">
          <Brain />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription title={description}>{description}</ItemDescription>
        </ItemContent>
        <ExtensionRowActions
          name={t('extensions.plugins.page.learning')}
          enabled={learning}
          disabled={disabled}
          onEnabledChange={onLearningChange}
          onDetails={open}
          leading={
            <Button type="button" variant="outline" size="sm" onClick={open}>
              {t('extensions.plugins.page.openMemory')}
            </Button>
          }
        />
      </ExtensionRow>
    </ExtensionGroup>
  );
}
