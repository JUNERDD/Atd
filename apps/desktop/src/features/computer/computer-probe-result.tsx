import type { ReactNode } from 'react';
import { AppWindow, CircleAlert, CircleCheck, Image, ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ComputerPrepareResult } from '@atd/agent-contracts';
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '@atd/ui/components/item';

/** The shell's read-only probe of an application it just registered. */
export type ComputerProbe = NonNullable<Extract<ComputerPrepareResult, { ok: true }>['probe']>;

function ProbeRow({ icon, ok, text }: { icon: ReactNode; ok: boolean; text: string }) {
  return (
    <Item asChild size="sm" className="px-0">
      <li data-state={ok ? 'ok' : 'missing'}>
        <ItemMedia variant="icon">{icon}</ItemMedia>
        <ItemContent>
          <ItemTitle className="font-normal whitespace-normal">{text}</ItemTitle>
        </ItemContent>
        <ItemMedia variant="icon" className={ok ? undefined : 'text-muted-foreground'}>
          {ok ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
        </ItemMedia>
      </li>
    </Item>
  );
}

/**
 * What the probe found, one fact per row: the app's open windows (none: Atd can act once one is
 * open), whether its controls were readable (Accessibility) and whether its windows could be
 * pictured (Screen Recording), each missing fact naming where to fix it.
 */
export function ComputerProbeResult({ probe }: { probe: ComputerProbe }) {
  const { t } = useTranslation('settings');
  return (
    <ItemGroup aria-label={t('computer.application.probe.description')}>
      <ProbeRow
        icon={<AppWindow />}
        ok={probe.windows > 0}
        text={
          probe.windows > 0
            ? t('computer.application.probe.windows', { count: probe.windows })
            : t('computer.application.probe.noWindows')
        }
      />
      <ProbeRow
        icon={<ListTree />}
        ok={probe.tree}
        text={
          probe.tree ? t('computer.application.probe.tree') : t('computer.application.probe.noTree')
        }
      />
      <ProbeRow
        icon={<Image />}
        ok={probe.screenshot}
        text={
          probe.screenshot
            ? t('computer.application.probe.screenshot')
            : t('computer.application.probe.noScreenshot')
        }
      />
    </ItemGroup>
  );
}
