import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AutomationDraft, AutomationItem } from '@atd/agent-contracts';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showToast } from '../../components/toast-store';
import { useAgent } from '../agent/use-agent';
import type { SettingsAutomationTarget } from '../settings/settings-navigation';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';
import { copyDraft, draftFromCommand, draftOf, newDraft } from './automation-draft';
import { AutomationEditor } from './automation-editor';
import { AutomationOverview } from './automation-overview';
import { AutomationRuns } from './automation-runs';
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
  /** The latest "Automate…" link from a command's row; each new nonce opens a prefilled editor. */
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
  // An "Automate…" link opens its editor as a page of the history, once per request.
  const [linked, setLinked] = useState<number | null>(null);
  if (activeTarget && activeTarget.nonce !== linked) {
    setLinked(activeTarget.nonce);
    const command = commands.find(({ id }) => id === activeTarget.commandId);
    openDraft(
      command
        ? draftFromCommand(command)
        : {
            ...newDraft(),
            action: {
              kind: 'command',
              commandId: activeTarget.commandId,
              arguments: {},
              input: '',
            },
          },
    );
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
  if (id !== null)
    return (
      <section className="automation-settings">
        <output className="settings-loading">{t('list.loading')}</output>
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
