import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMemoryCreate } from '../memory/use-memory-create';
import { extensionSeed, type SeedKind } from './extension-seed';

/** Longest answer a Remember seed quotes in full. */
const REMEMBER_LIMIT = 90_000;

/** The edit-with-AI sentence per extension kind; memory sessions never carry a target. */
const EDIT_SEEDS = {
  skill: 'session.editSkillSeed',
  subagent: 'session.editSubagentSeed',
  mcp: 'session.editMcpSeed',
} as const;

/**
 * The panel's create-with-AI sessions: each seeds a `create-*` skill chip on the new draft
 * (`extensionSeed`), and edit-with-AI adds a sentence naming the existing item. Settings hands
 * command, automation and extension sessions over the agent bridge and Create app over the apps
 * bridge; Remember and the panel's own Create app start here.
 * `apply` puts a seed on the new draft and shows it.
 */
export function useSeededSessions(apply: (seed: ReturnType<typeof extensionSeed>) => void) {
  const { t } = useTranslation('panel');
  const memoryCreate = useMemoryCreate();
  const latest = useRef(apply);
  useLayoutEffect(() => {
    latest.current = apply;
  });
  const startSeeded = (kind: SeedKind, sentence: string) =>
    latest.current(extensionSeed(kind, sentence));
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onCommandSession(({ commandId, name }) =>
      latest.current(
        extensionSeed('command', commandId ? t('session.editSeed', { name, id: commandId }) : ''),
      ),
    );
  }, [t]);
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onAutomationSession((automation) =>
      latest.current(
        extensionSeed(
          'automation',
          automation
            ? t('session.editAutomationSeed', { name: automation.name, id: automation.id })
            : '',
        ),
      ),
    );
  }, [t]);
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onExtensionSession(({ kind, target }) =>
      latest.current(
        extensionSeed(
          kind,
          target === null || kind === 'memory' ? '' : t(EDIT_SEEDS[kind], { name: target }),
        ),
      ),
    );
  }, [t]);
  useEffect(() => window.desktop?.apps?.onCreateInPanel(() => startSeeded('app', '')), []);
  return {
    /** A memory session seeded with `text` (a turn's answer), once memory can save it. */
    remember: (text: string) => {
      // The seed becomes the draft, whose text the service caps at 100,000 characters; a longer
      // answer is cut with an ellipsis, leaving room for the chip and the sentence around it.
      const quoted = text.length > REMEMBER_LIMIT ? `${text.slice(0, REMEMBER_LIMIT)}…` : text;
      memoryCreate.start(null, () =>
        startSeeded('memory', t('session.rememberSeed', { text: quoted })),
      );
    },
    /** A Create app session: the `create-app` skill chip on the new draft, for the user to complete. */
    createApp: () => startSeeded('app', ''),
  };
}
