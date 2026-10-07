import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MemoryProposal, MemoryProposalKind, MemoryUnit } from '@atd/agent-contracts';
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
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { MEMORY_TYPES, PROPOSAL_KINDS } from './memory-labels';

/** Whether accepting each kind writes the suggestion's text (`body`). */
const WRITES_TEXT = {
  create: true,
  update: true,
  skill: true,
  remove: false,
  core: false,
} as const satisfies Record<MemoryProposalKind, boolean>;

/**
 * What accepting a suggestion writes (a memory's content, or a skill's SKILL.md body), behind a
 * link that shows it below, where a long text scrolls on its own. The region stays in the page
 * while hidden, so the link's `aria-controls` always names it (Radix Collapsible's trigger drops
 * it while closed).
 */
function ProposalText({ text }: { text: string }) {
  const { t } = useTranslation('memory');
  const regionId = useId();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="link"
        size="xs"
        className="self-start px-0"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(!open)}
      >
        {open ? t('memory.suggestions.hideText') : t('memory.suggestions.showText')}
      </Button>
      <div id={regionId} hidden={!open}>
        {open ? (
          <ScrollArea scrollShadow className="max-h-40">
            <p className="text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
              {text}
            </p>
          </ScrollArea>
        ) : null}
      </div>
    </>
  );
}

/**
 * What the learner suggests and waits on the user for, above the memories: removing a memory,
 * making one always present, a Personal skill from a learned procedure, or (with Ask before saving
 * on) a new or updated memory. Each row marks what accepting does, offers the text it would write,
 * and says why, with Dismiss and Accept; accepting or dismissing leaves the row, which is the
 * feedback. A suggestion whose memory changed since keeps only Dismiss. Nothing shows without
 * suggestions.
 */
export function MemorySuggestions({
  proposals,
  units,
  busyIds,
  onAccept,
  onDismiss,
}: {
  proposals: readonly MemoryProposal[];
  /** The memories, for the description of the one a removal or promotion acts on. */
  units: readonly MemoryUnit[];
  /** The proposals being accepted or dismissed, whose actions keep focus but ignore input. */
  busyIds: ReadonlySet<string>;
  onAccept: (proposal: MemoryProposal) => void;
  onDismiss: (proposal: MemoryProposal) => void;
}) {
  const { t } = useTranslation('memory');
  const headingId = useId();
  if (!proposals.length) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby={headingId}>
      <h3 id={headingId} className="settings-section-title">
        {t('memory.suggestions.title')}
      </h3>
      <ItemGroup>
        {proposals.map((proposal) => {
          const { icon: Icon, labelKey } = PROPOSAL_KINDS[proposal.kind];
          const target = proposal.unitId
            ? units.find((unit) => unit.id === proposal.unitId)
            : undefined;
          const title = proposal.description || target?.description || proposal.name;
          // A suggestion made against an earlier version of its memory can only be dismissed: the
          // service refuses to accept it over the newer version.
          const outdated =
            proposal.revision !== null && (!target || target.revision !== proposal.revision);
          const kind = [
            t(labelKey),
            proposal.name,
            proposal.type ? t(MEMORY_TYPES[proposal.type].labelKey) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const busy = busyIds.has(proposal.id);
          const busyProps = {
            'aria-disabled': busy || undefined,
            'aria-busy': busy || undefined,
            className: 'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
          };
          return (
            <Item asChild key={proposal.id} size="sm" variant="outline">
              <li>
                <ItemMedia variant="icon">
                  <Icon />
                </ItemMedia>
                <ItemContent className="min-w-40">
                  <ItemTitle title={title}>{title}</ItemTitle>
                  <ItemDescription>{kind}</ItemDescription>
                  {WRITES_TEXT[proposal.kind] && proposal.body ? (
                    <ProposalText text={proposal.body} />
                  ) : null}
                  {proposal.reason ? <ItemDescription>{proposal.reason}</ItemDescription> : null}
                  {outdated ? (
                    <ItemDescription>{t('memory.suggestions.outdated')}</ItemDescription>
                  ) : null}
                </ItemContent>
                {/* At the top, so revealing the text never moves them; a row too narrow for the text
                    beside them wraps them under it, at its end. */}
                <ItemActions className="ms-auto self-start">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('memory.suggestions.dismissFor', { name: proposal.name })}
                    {...busyProps}
                    onClick={() => {
                      if (!busy) onDismiss(proposal);
                    }}
                  >
                    {t('memory.suggestions.dismiss')}
                  </Button>
                  {outdated ? null : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t('memory.suggestions.acceptFor', { name: proposal.name })}
                      {...busyProps}
                      onClick={() => {
                        if (!busy) onAccept(proposal);
                      }}
                    >
                      {t('memory.suggestions.accept')}
                    </Button>
                  )}
                </ItemActions>
              </li>
            </Item>
          );
        })}
      </ItemGroup>
    </section>
  );
}
