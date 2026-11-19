import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LiveProbeKind } from '@atd/agent-contracts';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import type { LiveProbeEvent } from '../../client/diagnostics-contract';
import { showErrorToast } from '../../components/toast-store';
import { SettingsSectionActiveContext } from '../settings/settings-navigation';
import { PROBE_KIND_KEYS } from './diagnostics-labels';
import { formatLiveProbeSummary } from './live-probe-format';

const PROBE_KINDS: readonly LiveProbeKind[] = ['selection', 'hotkey', 'capture'];

const ENDED_REASON_KEYS = {
  running: 'liveProbes.endedReasons.running',
  timeout: 'liveProbes.endedReasons.timeout',
  stopped: 'liveProbes.endedReasons.stopped',
  window_closed: 'liveProbes.endedReasons.window_closed',
} as const;

export function LiveProbePanel({
  requestedProbe,
  onRequestedProbeHandled,
}: {
  requestedProbe?: LiveProbeKind | null;
  onRequestedProbeHandled?: () => void;
}) {
  const { t } = useTranslation('diagnostics');
  const sectionActive = useContext(SettingsSectionActiveContext);
  const [activeKind, setActiveKind] = useState<LiveProbeKind | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [latestEvents, setLatestEvents] = useState<Partial<Record<LiveProbeKind, LiveProbeEvent>>>(
    {},
  );
  const activeKindRef = useRef<LiveProbeKind | null>(null);
  const activeProbeIdRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);
  const inFlightRef = useRef(false);
  const sectionActiveRef = useRef(sectionActive);
  const mountedRef = useRef(true);
  const onRequestedProbeHandledRef = useRef(onRequestedProbeHandled);

  useLayoutEffect(() => {
    sectionActiveRef.current = sectionActive;
  }, [sectionActive]);

  useLayoutEffect(() => {
    onRequestedProbeHandledRef.current = onRequestedProbeHandled;
  }, [onRequestedProbeHandled]);

  const clearActive = useCallback(() => {
    activeKindRef.current = null;
    activeProbeIdRef.current = null;
    setActiveKind(null);
    setRemainingSeconds(0);
  }, []);

  const stopProbe = useCallback(async () => {
    if (activeKindRef.current === null && !inFlightRef.current) return;
    requestSeqRef.current += 1;
    inFlightRef.current = false;
    clearActive();
    await window.desktop?.diagnostics?.stopLiveProbe().catch(() => undefined);
  }, [clearActive]);

  const startProbe = useCallback((kind: LiveProbeKind, onSettled?: () => void) => {
    const diagnostics = window.desktop?.diagnostics;
    if (!diagnostics || !mountedRef.current || !sectionActiveRef.current) {
      onSettled?.();
      return Promise.resolve();
    }
    const seq = ++requestSeqRef.current;
    inFlightRef.current = true;
    return diagnostics
      .startLiveProbe(kind)
      .then((started) => {
        if (!mountedRef.current || !sectionActiveRef.current || requestSeqRef.current !== seq) {
          void diagnostics.stopLiveProbe().catch(() => undefined);
          return;
        }
        activeKindRef.current = kind;
        activeProbeIdRef.current = started.probeId;
        setActiveKind(kind);
        setRemainingSeconds(Math.max(1, Math.ceil(started.durationMs / 1000)));
      })
      .catch((error: unknown) => {
        if (mountedRef.current && sectionActiveRef.current && requestSeqRef.current === seq) {
          showErrorToast(error);
        }
      })
      .finally(() => {
        if (requestSeqRef.current === seq) {
          inFlightRef.current = false;
        }
        onSettled?.();
      });
  }, []);

  useEffect(() => {
    if (!requestedProbe) return;
    void startProbe(requestedProbe, () => onRequestedProbeHandledRef.current?.());
  }, [requestedProbe, startProbe]);

  useEffect(() => {
    const diagnostics = window.desktop?.diagnostics;
    if (!diagnostics) return;
    return diagnostics.onLiveProbeEvent((event) => {
      if (activeProbeIdRef.current !== null && event.probeId !== activeProbeIdRef.current) {
        return;
      }
      setLatestEvents((prev) => ({ ...prev, [event.kind]: event }));
      if (event.endedReason === 'running') {
        setRemainingSeconds(Math.max(1, Math.ceil(event.remainingMs / 1000)));
      } else if (activeKindRef.current === event.kind) {
        clearActive();
      }
    });
  }, [clearActive]);

  useEffect(() => {
    if (!activeKind) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeKind]);

  // Immediately disarm the shell's 10s probe when switching to another settings section.
  const [wasActive, setWasActive] = useState(sectionActive);
  if (sectionActive !== wasActive) {
    setWasActive(sectionActive);
    if (!sectionActive && activeKind !== null) {
      setActiveKind(null);
      setRemainingSeconds(0);
    }
  }

  useEffect(() => {
    if (!sectionActive) {
      void stopProbe();
    }
  }, [sectionActive, stopProbe]);

  // Also disarm on component unmount (and <Activity mode="hidden"> cleanup).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopProbe();
    };
  }, [stopProbe]);

  return (
    <section
      className="flex flex-col gap-3"
      data-settings-anchor="diagnostics-live-probes"
      aria-label={t('liveProbes.title')}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">{t('liveProbes.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('liveProbes.description')}</p>
      </div>
      <ItemGroup>
        {PROBE_KINDS.map((kind) => {
          const isRunning = activeKind === kind;
          const event = latestEvents[kind];
          const copy = PROBE_KIND_KEYS[kind];
          return (
            <Item key={kind} variant="outline" size="sm" asChild>
              <li>
                <div className="flex w-full flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <ItemMedia variant="icon">
                      <Activity aria-hidden="true" className="text-muted-foreground" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="whitespace-normal">{t(copy.title)}</ItemTitle>
                      <ItemDescription className="whitespace-normal">
                        {t(copy.description)}
                      </ItemDescription>
                      {event ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge
                            variant={event.endedReason === 'running' ? 'default' : 'secondary'}
                          >
                            {t(ENDED_REASON_KEYS[event.endedReason])}
                          </Badge>
                          <code className="font-mono text-xs break-all">
                            {formatLiveProbeSummary(event)}
                          </code>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">{t('liveProbes.idle')}</p>
                      )}
                    </ItemContent>
                  </div>
                  <ItemActions className="shrink-0">
                    {isRunning ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void stopProbe()}
                      >
                        <Square data-icon="inline-start" aria-hidden="true" />
                        {t('liveProbes.stopRemaining', { seconds: remainingSeconds })}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!window.desktop?.diagnostics}
                        onClick={() => void startProbe(kind)}
                      >
                        <Play data-icon="inline-start" aria-hidden="true" />
                        {t('liveProbes.start')}
                      </Button>
                    )}
                  </ItemActions>
                </div>
              </li>
            </Item>
          );
        })}
      </ItemGroup>
    </section>
  );
}
