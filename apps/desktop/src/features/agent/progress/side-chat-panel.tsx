import { useTranslation } from 'react-i18next';
import type { SideChatItem } from '../side-chat/side-chats';
import { StatusList, StatusRow } from './status-row';

/**
 * The composer popover's Side chats view: the conversation's side chats as one flat list, in the
 * order `sideChatItems` gives (by state, then newest first), each state shown by the row's leading
 * glyph and, under its title, in words with the text it ran on, which tells side chats of one command
 * apart. Choosing a row opens that side chat over the conversation; the one already open (`current`)
 * is marked. Titles and excerpts are the tasks' own text, so they are never translated.
 */
export function SideChatPanel({
  items,
  current,
  onOpen,
}: {
  items: readonly SideChatItem[];
  /** The task id of the side chat on screen, if one is. */
  current: string | null;
  onOpen: (taskId: string) => void;
}) {
  const { t } = useTranslation('panel');
  return (
    <StatusList title={t('composer.progress.sideChats.list')}>
      {items.map((item) => (
        <StatusRow
          key={item.taskId}
          glyph={item.state}
          text={item.title}
          context={item.excerpt}
          title={item.title}
          actionLabel={t('composer.progress.sideChats.open', { name: item.title })}
          current={item.taskId === current}
          onOpen={() => onOpen(item.taskId)}
        />
      ))}
    </StatusList>
  );
}
