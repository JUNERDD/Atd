import { useEffect, useRef, useState } from 'react';
import type { LoginState } from '../../client/providers/schema';
import { useTranslation } from 'react-i18next';

/** Owns a form's sign-in across the transition from a draft to a saved connection. */
export function useProviderLogin() {
  const { i18n } = useTranslation();
  const bridge = window.desktop?.settings.providers;
  const [state, setState] = useState<LoginState | null>(null);
  const current = useRef<LoginState | null>(null);
  const connection = useRef<string | null>(null);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    if (!bridge) return;
    const unsubscribe = bridge.onLogin((next) => {
      if (next.connectionId !== connection.current) return;
      if (current.current?.status === 'waiting' && current.current.id !== next.id) return;
      current.current = next;
      setState(next);
    });
    return () => {
      active.current = false;
      unsubscribe();
      if (current.current?.status === 'waiting')
        void bridge.cancel(current.current.id).catch(() => {});
    };
  }, [bridge]);

  async function start(connectionId: string, enablePlanUsage = false) {
    if (!bridge || !active.current) return;
    connection.current = connectionId;
    const next = await bridge.login(connectionId, {
      enablePlanUsage,
      language: i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en',
    });
    if (!active.current) {
      await bridge.cancel(next.id);
      return;
    }
    // A login notification can arrive before the request returns; keep the newer state.
    if (current.current?.id !== next.id) current.current = next;
    setState(current.current);
  }

  async function cancel() {
    if (current.current?.status === 'waiting') await bridge?.cancel(current.current.id);
  }

  return { state, waiting: state?.status === 'waiting', start, cancel };
}
