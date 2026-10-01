import { useEffect, useState } from 'react';
import { ArrowUpRight, Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { IconButton } from '../../components/icon-button';
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
 * counts its entries, links there (Open memory settings in More's column, as command rows open
 * the Commands section), and carries the learning switch, which is the memory item's
 * switch: turning it off pauses learning. Pausing is undone by the same switch, so it asks for no
 * confirmation; the row says what pausing does, wrapping rather than cutting the sentence off.
 */
export function PluginMemoryGroup({
  learning,
  disabled,
  pending = false,
  onLearningChange,
  showTitle = true,
}: {
  learning: boolean;
  /** No service to save to: the switch cannot work at all. */
  disabled: boolean;
  /** A write for the plugin is running: the switch keeps focus but ignores changes. */
  pending?: boolean;
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
          <ItemDescription className="whitespace-normal">
            {t('extensions.plugins.page.learningHint')}
          </ItemDescription>
        </ItemContent>
        <ExtensionRowActions
          name={t('extensions.plugins.page.learning')}
          enabled={learning}
          disabled={disabled}
          pending={pending}
          onEnabledChange={onLearningChange}
          onDetails={open}
          trailing={
            <IconButton label={t('extensions.plugins.page.openMemory')} onClick={open}>
              <ArrowUpRight />
            </IconButton>
          }
        />
      </ExtensionRow>
    </ExtensionGroup>
  );
}
