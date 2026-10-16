import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutomationDraft, AutomationItem } from '@atd/agent-contracts';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { LoadingPlaceholder } from '../../components/loading-placeholder';
import { showToast } from '../../components/toast-store';
import { useAgent } from '../agent/use-agent';
import type { SettingsAutomationTarget } from '../settings/settings-navigation';
import {
  SettingsEditorPlaceholder,
  SettingsHeadingPlaceholder,
} from '../settings/settings-page-placeholder';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';
import { copyDraft, draftFromCommand, draftOf, newDraft } from './automation-draft';
import { AutomationEditor } from './automation-editor';
import { AutomationOverview } from './automation-overview';
import { AutomationRuns, RunRowsPlaceholder } from './automation-runs';
import { startRun, useAutomations } from './use-automations';
import './automations.css';

/**
 * A page of the Automations section: the list, a saved automation's editor (`turnOn` when its
 * switch asked to turn on a one-time automation whose time has passed, which needs a new time
 * first), a new, copied or command-started automation's editor until it is saved, or a saved
 * automation's run history.
 */
type AutomationRoute =
  | { page: 'list' }
  | { page: 'automation'; id: string; turnOn?: true }
  | { page: 'draft'; key: string; draft: AutomationDraft }
  | { page: 'runs'; id: string };
const LIST: AutomationRoute = { page: 'list' };

const savedId = (route: AutomationRoute) =>
  route.page === 'automation' || route.page === 'runs' ? route.id : null;

/**
 * The Automations section: every automation with Run now, its switch and More, the global pause,
 * an editor for each, and each one's run history. Pages follow the section's history (the
 * header's Back and Forward); an automation deleted while its page is shown leaves the page.
 */
export function AutomationSettings({
  settings,
  activeTarget,
}: {
  settings: SettingsSnapshot | null;
  /**
   * The latest link: "Automate…" on a command's row, whose each new nonce opens a prefilled
   * editor, or a saved automation's page.
   */
  activeTarget?: (SettingsAutomationTarget & { nonce: number }) | null;
}) {
  const { t } = useTranslation('automations');
  const list = useAutomations();
  const items = list.automations;
  const commands = useAgent().snapshot?.commands ?? [];
  const history = useSettingsPageHistory<AutomationRoute>(LIST, (route) => {
    const id = savedId(route);
    return id === null || !items || items.some(({ automation }) => automation.id === id);
  });
  const openDraft = (draft: AutomationDraft) =>
    history.open({ page: 'draft', key: crypto.randomUUID(), draft });
  /** A new automation's editor that runs one command, as "Automate…" on its row opens it. */
  const openCommandDraft = (commandId: string) => {
    const command = commands.find(({ id }) => id === commandId);
    openDraft(
      command
        ? draftFromCommand(command)
        : {
            ...newDraft(),
            action: { kind: 'command', commandId, arguments: {}, input: '' },
          },
    );
  };
  // A link opens its page of the history once per request: an "Automate…" link a prefilled
  // editor, a saved automation's link that automation's page.
  const [linked, setLinked] = useState<number | null>(null);
  if (activeTarget && activeTarget.nonce !== linked) {
    setLinked(activeTarget.nonce);
    if ('automationId' in activeTarget)
      history.open({ page: 'automation', id: activeTarget.automationId });
    else openCommandDraft(activeTarget.commandId);
  }
  const { route } = history;
  const id = savedId(route);
  const shown = id === null ? undefined : items?.find(({ automation }) => automation.id === id);
  // A link to an unknown id, or an automation deleted meanwhile, falls back to the list.
  if (id !== null && items && !shown) history.discard();
  const run = (item: AutomationItem) => startRun(item, t);

  /**
   * An editor page: a draft's until it is saved (`saved` null), else a saved automation's, which
   * keeps its edits while the automation changes elsewhere; saving then reports the conflict.
   */
  function editor(
    from: AutomationRoute,
    key: string,
    initial: AutomationDraft,
    saved: AutomationItem | null,
    start?: AutomationDraft,
  ) {
    return (
      <AutomationEditor
        key={key}
        initial={initial}
        {...(start ? { start } : {})}
        saved={saved}
        unavailable={list.problem !== null}
        settings={settings}
        automations={items}
        commands={commands}
        onCancel={history.back}
        onSaved={(item, thenRun) => {
          // A saved draft becomes its automation, which Forward then reopens.
          if (saved) history.leave(from);
          else {
            const page: AutomationRoute = { page: 'automation', id: item.automation.id };
            history.replace(page, from);
            history.leave(page);
          }
          showToast({ kind: 'info', text: t('list.saved') });
          if (thenRun) run(item);
        }}
      />
    );
  }
  if (route.page === 'draft') return editor(route, route.key, route.draft, null);
  if (route.page === 'automation' && shown) {
    const stored = draftOf(shown.automation);
    // Opened to turn a past one-time automation on: switched on, waiting for its new time.
    return route.turnOn
      ? editor(route, `${route.id}:on`, stored, shown, { ...stored, enabled: true })
      : editor(route, route.id, stored, shown);
  }
  if (route.page === 'runs' && shown)
    return (
      <AutomationRuns
        item={shown}
        unavailable={list.problem !== null}
        onEdit={() => history.open({ page: 'automation', id: shown.automation.id })}
        onRun={() => run(shown)}
      />
    );
  // A deep link opened before the automations are read: its page's shape until they arrive.
  if (id !== null)
    return (
      <section className="automation-settings">
        {route.page === 'runs' ? (
          <LoadingPlaceholder label={t('list.loading')} className="gap-4">
            <SettingsHeadingPlaceholder subpage />
            <div className="automation-runs-body">
              <RunRowsPlaceholder />
            </div>
          </LoadingPlaceholder>
        ) : (
          <SettingsEditorPlaceholder label={t('list.loading')} />
        )}
      </section>
    );
  return (
    <AutomationOverview
      list={list}
      onCreate={() => openDraft(newDraft())}
      onOpen={(item) => history.open({ page: 'automation', id: item.automation.id })}
      onRuns={(item) => history.open({ page: 'runs', id: item.automation.id })}
      onRun={run}
      onReschedule={(item) =>
        history.open({ page: 'automation', id: item.automation.id, turnOn: true })
      }
      onDuplicate={(item) =>
        openDraft(copyDraft(item.automation, (name) => t('list.copyName', { name })))
      }
    />
  );
}
