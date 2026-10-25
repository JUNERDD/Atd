import type { ReactNode } from 'react';
import { AppWindow, Globe, MousePointerClick, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COMPUTER_BROWSER_ADDON } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import type { TargetKind } from './computer-target-words';

/**
 * The add-on whose engine operates each kind of target, which needs it installed to be added;
 * null for applications, whose engine is part of Atd.
 */
const KIND_ADDONS: Record<TargetKind, string | null> = {
  browser: COMPUTER_BROWSER_ADDON,
  application: null,
};

/** Whether a kind's engine is there: built in, or its add-on installed. */
function engineInstalled(kind: TargetKind, installed: ReadonlySet<string>) {
  const addon = KIND_ADDONS[kind];
  return addon === null || installed.has(addon);
}

interface AddTargetProps {
  /** No service connection: nothing can be added. */
  offline: boolean;
  /** Ids of the installed add-ons; a kind whose engine is an add-on needs it. */
  installed: ReadonlySet<string>;
  onAdd: (kind: TargetKind) => void;
}

function useKinds() {
  const { t } = useTranslation('settings');
  const kinds: { kind: TargetKind; icon: ReactNode; title: string; hint: string }[] = [
    {
      kind: 'browser',
      icon: <Globe />,
      title: t('computer.targets.kind.browser'),
      hint: t('computer.targets.browserHint'),
    },
    {
      kind: 'application',
      icon: <AppWindow />,
      title: t('computer.targets.kind.application'),
      hint: t('computer.targets.applicationHint'),
    },
  ];
  return kinds;
}

/**
 * Add target, the page's one primary action: a menu of a browser environment and an application,
 * each with what it is, or that its engine needs installing first (only the browser engine is an
 * add-on).
 */
export function AddTargetMenu({ offline, installed, onAdd }: AddTargetProps) {
  const { t } = useTranslation('settings');
  const kinds = useKinds();
  const canAdd = (kind: TargetKind) => engineInstalled(kind, installed);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={offline} data-settings-anchor="computer-add">
          <Plus />
          {t('computer.targets.add')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-72">
        {kinds.map(({ kind, icon, title, hint }) => (
          <DropdownMenuItem
            key={kind}
            className="items-start"
            disabled={!canAdd(kind)}
            onSelect={() => onAdd(kind)}
          >
            {icon}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span>{title}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {canAdd(kind) ? hint : t('computer.targets.needsEngine')}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const EMPTY_ICONS: Record<TargetKind, ReactNode> = {
  browser: <Globe />,
  application: <AppWindow />,
};

const EMPTY_LABELS = {
  browser: 'computer.targets.addBrowser',
  application: 'computer.targets.addApplication',
} as const satisfies Record<TargetKind, string>;

/**
 * The Targets group before any target exists, framed like the cards around it so the group keeps
 * its place on the page, with one button per kind; the buttons wrap on a narrow window.
 */
export function AddTargetEmpty({ offline, installed, onAdd }: AddTargetProps) {
  const { t } = useTranslation('settings');
  const canAdd = (kind: TargetKind) => engineInstalled(kind, installed);
  const kinds: TargetKind[] = ['browser', 'application'];
  return (
    <Empty className="border px-4 py-8" data-settings-anchor="computer-targets">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MousePointerClick />
        </EmptyMedia>
        <EmptyTitle>{t('computer.targets.emptyTitle')}</EmptyTitle>
        <EmptyDescription>{t('computer.targets.emptyDescription')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row flex-wrap justify-center">
        {kinds.map((kind) => (
          <Button
            key={kind}
            variant="outline"
            disabled={offline || !canAdd(kind)}
            onClick={() => onAdd(kind)}
          >
            {EMPTY_ICONS[kind]}
            {t(EMPTY_LABELS[kind])}
          </Button>
        ))}
      </EmptyContent>
    </Empty>
  );
}
