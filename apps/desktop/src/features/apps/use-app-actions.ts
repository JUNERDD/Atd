import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppDetail, Capability, GrantState } from '@atd/agent-contracts';
import { showErrorToast, showToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';
import { appKeys, appsBridge } from './use-apps';

/**
 * The writes on apps, shared by the panel, the transcript card and settings. Each one runs at
 * most once per app at a time (`busy` holds the apps with a write in flight), reloads the app
 * queries once the service answered, and reports a failure as a toast; the promise then resolves
 * with null instead of rejecting.
 */
export function useAppActions() {
  const { t } = useTranslation('apps');
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());

  async function run<T>(appId: string, write: () => Promise<T>): Promise<T | null> {
    if (busy.has(appId)) return null;
    setBusy((current) => new Set(current).add(appId));
    try {
      const result = await write();
      void queryClient.invalidateQueries({ queryKey: appKeys.all });
      return result;
    } catch (error) {
      showErrorToast(error);
      return null;
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(appId);
        return next;
      });
    }
  }

  /** A write's answer is the app as it now is: its page shows it before the reload lands. */
  function keep(detail: AppDetail | null) {
    if (detail) queryClient.setQueryData(appKeys.detail(detail.id), detail);
    return detail;
  }

  return {
    busy,
    open: (appId: string) => run(appId, () => appsBridge().open(appId)),
    /** The task to continue in; the caller shows it. */
    edit: (appId: string) => run(appId, () => appsBridge().edit(appId)),
    rename: async (appId: string, name: string) => {
      const detail = keep(await run(appId, () => appsBridge().rename(appId, name)));
      if (detail) showToast({ kind: 'info', text: t('rename.done') });
      return detail !== null;
    },
    remove: async (appId: string) => {
      const done = await run(appId, async () => {
        await appsBridge().remove(appId);
        return true;
      });
      if (done) showToast({ kind: 'info', text: t('feedback.deleted') });
      return done === true;
    },
    clearData: async (appId: string) => {
      const detail = keep(await run(appId, () => appsBridge().clearData(appId)));
      if (detail) showToast({ kind: 'info', text: t('feedback.cleared') });
    },
    revert: async (appId: string, version: number) => {
      const detail = keep(await run(appId, () => appsBridge().revert(appId, version)));
      if (detail)
        showToast({
          kind: 'info',
          text: t('feedback.reverted', { version, current: detail.currentVersion }),
        });
    },
    /** Answers a consent or changes a grant; `null` forgets it, so the next use asks again. */
    setGrant: async (appId: string, capability: Capability, state: GrantState | null) =>
      keep(await run(appId, () => appsBridge().setGrants(appId, { [capability]: state }))),
    showInSettings: (appId: string) => run(appId, () => appsBridge().showInSettings(appId)),
  };
}

export type AppActions = ReturnType<typeof useAppActions>;
