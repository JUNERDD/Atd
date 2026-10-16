import { useId } from 'react';
import { MotionConfig, Reorder } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from '@atd/ui/components/empty';
import { ItemGroup } from '@atd/ui/components/item';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { keyedShortcuts } from '@atd/agent-contracts';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { CommandRow, type CommandMatch, type CommandRowActions } from './command-row';
import { useCommandOrder } from './use-command-order';

type Row = { command: CommandDefinition; match: CommandMatch };

/**
 * What the row says about its shortcuts: the command's launch failure, else the registration
 * failure of the shortcut its column shows (the first with keys). The editor shows the others.
 */
function rowError(
  command: CommandDefinition,
  errors: Readonly<Record<string, string>>,
): string | undefined {
  const first = keyedShortcuts(command)[0];
  return errors[command.id] ?? (first && errors[first.id]);
}

/**
 * The user's commands in their saved order, which a long press or Option-arrow keys change, then
 * each plugin's commands under its plugin id (display names are not on this bridge) in the
 * service's name order. While the user's commands can move, a line above them says how, and each
 * row's button is described by it. The search matches and marks what rows show; while it filters,
 * the order holds still and the line is gone.
 */
export function CommandList({
  commands,
  query,
  pendingIds,
  shortcutErrors,
  onClearSearch,
  ...actions
}: {
  commands: readonly CommandDefinition[];
  query: string;
  /** The commands being saved, whose rows' run and enable controls wait; other rows stay usable. */
  pendingIds: ReadonlySet<string>;
  /** Launch failures keyed by command id and registration failures by shortcut id. */
  shortcutErrors: Readonly<Record<string, string>>;
  onClearSearch: () => void;
} & CommandRowActions) {
  const { t } = useTranslation('commands');
  const order = useCommandOrder(commands);
  const hintId = useId();
  const byId = new Map(commands.map((command) => [command.id, command]));
  const groups = new Map<string, Row[]>([['', []]]);
  const ordered = [
    ...order.shown.flatMap((id) => byId.get(id) ?? []),
    ...commands.filter((command) => command.pluginId),
  ];
  for (const command of ordered) {
    const match = matchFields(query, { name: command.name, description: command.description });
    if (!match && query.trim()) continue;
    const key = command.pluginId ?? '';
    groups.set(key, [...(groups.get(key) ?? []), { command, match }]);
  }
  const personal = groups.get('')!;
  const movable = !query.trim() && order.shown.length > 1;
  const titled = commands.some((command) => command.pluginId);
  const row = ({ command, match }: Row) => (
    <CommandRow
      key={command.id}
      command={command}
      match={match}
      busy={pendingIds.has(command.id)}
      shortcutError={rowError(command, shortcutErrors)}
      order={
        command.pluginId
          ? undefined
          : {
              movable,
              hintId: movable ? hintId : undefined,
              onDrop: order.commit,
              onMove: (offset) => order.move(command.id, offset),
            }
      }
      {...actions}
    />
  );
  if (query.trim() && commands.length && [...groups.values()].every((rows) => !rows.length))
    return (
      <div className="settings-extension-empty">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>{t('list.noMatches', { query: query.trim() })}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onClearSearch}>
              {t('list.clearSearch')}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  // Motion's `Reorder` owns the drag and the make-way animation; its group only provides the
  // context, so the shared ItemGroup keeps the list's own element and spacing.
  const personalGroup = (
    <>
      {movable && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('list.reorderHint')}
        </p>
      )}
      <MotionConfig reducedMotion="user">
        <Reorder.Group
          as="div"
          axis="y"
          values={personal.map(({ command }) => command.id)}
          onReorder={order.reorder}
        >
          <ItemGroup>{personal.map(row)}</ItemGroup>
        </Reorder.Group>
      </MotionConfig>
    </>
  );
  if (!titled) return <div className="command-group">{personalGroup}</div>;
  return (
    <div className="command-groups">
      {[...groups].map(([plugin, rows]) =>
        rows.length ? (
          <section
            key={plugin}
            className="command-group"
            aria-label={plugin ? t('list.pluginGroupFor', { plugin }) : t('list.personal')}
          >
            <h3>{plugin || t('list.personal')}</h3>
            {plugin ? <ItemGroup>{rows.map(row)}</ItemGroup> : personalGroup}
          </section>
        ) : null,
      )}
    </div>
  );
}
