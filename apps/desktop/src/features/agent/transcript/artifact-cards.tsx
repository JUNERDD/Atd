import {
  BookOpen,
  Bot,
  Brain,
  ChevronRight,
  Command,
  Plug,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProductArtifact } from '@atd/agent-contracts';
import { AppCard } from '../../apps/app-card';
import type { ViewBlock } from './adapter';
import { openArtifact, turnArtifactsIn, type TurnArtifact } from './product-artifacts';
import './artifact-cards.css';

/** Items with the shared card; an app keeps its own card (`AppCard`). */
type CardKind = Exclude<ProductArtifact['kind'], 'app'>;

/** Each kind's mark and name, the same marks Settings and its Create menu show for them. */
const KINDS = {
  command: { icon: Command, label: 'artifacts.kind.command' },
  automation: { icon: Zap, label: 'artifacts.kind.automation' },
  skill: { icon: BookOpen, label: 'artifacts.kind.skill' },
  subagent: { icon: Bot, label: 'artifacts.kind.subagent' },
  mcp: { icon: Plug, label: 'artifacts.kind.mcp' },
  memory: { icon: Brain, label: 'artifacts.kind.memory' },
} as const satisfies Record<CardKind, { icon: LucideIcon; label: string }>;

/**
 * One saved item as a single control: the whole card opens it where the user manages it, so
 * there is one target and no second action to aim for. It reads by the item's name, with its
 * kind and whether this turn created or changed it on the quieter line below, and a trailing
 * chevron that says it leads elsewhere.
 */
function ArtifactCard({ artifact, kind }: { artifact: ProductArtifact; kind: CardKind }) {
  const { t } = useTranslation('tasks');
  const { icon: Icon, label } = KINDS[kind];
  const detail = t('artifacts.detail', {
    kind: t(label),
    action: t(artifact.action === 'created' ? 'artifacts.created' : 'artifacts.updated'),
  });
  return (
    <button
      type="button"
      className="artifact-card"
      disabled={!window.desktop?.settings}
      aria-label={t('artifacts.openLabel', { name: artifact.name, detail })}
      onClick={() => void openArtifact(artifact)}
    >
      <span aria-hidden="true" className="artifact-card-icon">
        <Icon />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium" title={artifact.name}>
          {artifact.name}
        </span>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function TurnArtifactCard({ item }: { item: TurnArtifact }) {
  const { artifact, app } = item;
  if (artifact.kind !== 'app') return <ArtifactCard artifact={artifact} kind={artifact.kind} />;
  // An app's build record carries what its card shows; without one there is nothing to open.
  return app ? <AppCard details={app} /> : null;
}

/**
 * What the turn saved, at its end once it settled: one card per command, automation, app, skill,
 * subagent, MCP server or memory it created or changed, in the order it first saved them. Cards
 * that arrive as the turn settles in view rise into place; a turn that was already settled when
 * shown, as on reopening a task, shows them still.
 */
export function ArtifactCards({
  steps,
  appear,
}: {
  steps: readonly ViewBlock[];
  /** The turn settled while shown, so its cards are new to the user. */
  appear: boolean;
}) {
  const { t } = useTranslation('tasks');
  const items = turnArtifactsIn(steps);
  if (items.length === 0) return null;
  return (
    <ul
      className="artifact-cards"
      aria-label={t('artifacts.label')}
      data-appear={appear || undefined}
    >
      {items.map((item) => (
        <li key={`${item.artifact.kind}:${item.artifact.id}`}>
          <TurnArtifactCard item={item} />
        </li>
      ))}
    </ul>
  );
}
