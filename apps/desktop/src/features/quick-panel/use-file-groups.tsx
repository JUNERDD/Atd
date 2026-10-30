import { useState } from 'react';
import { File, FileSearch, FolderOpen, History, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import type { FileSearchResult } from '@atd/agent-contracts';
import type { AgentTask, FileRef } from '../../client/agent/task-schema';
import { FILE_KIND_ICONS } from '../../lib/file-kinds';
import { showErrorToast } from '../../components/toast-store';
import { reportImportFailures } from '../../components/use-imported-files';
import { fileSize } from '../../lib/file-size';
import { agentApi } from '../agent/use-agent';
import type { FileChip } from '../composer-editor/draft-attachments';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import type { QuickGroup, QuickOption } from './quick-options';
import { relativeTime } from './relative-time';
import { useFileSearch } from './use-file-search';

/** Run input limit (`InputSchema.files`), counted over the draft's file chips. */
const ATTACHMENT_LIMIT = 10;
const RECENT_ATTACHED_LIMIT = 3;
/** Main names iCloud Drive results from their own root; every other location is home-relative. */
const ICLOUD = 'iCloud Drive';

interface RecentAttachment {
  file: FileRef;
  at: number;
  /** Title of the conversation that attached it last. */
  source: string;
}

/**
 * Files that earlier runs attached, newest first and once per resource id. The service keeps
 * uploaded resources, so a pick reuses the `FileRef` as is and never reads the file again.
 */
function recentAttachments(tasks: readonly AgentTask[]): RecentAttachment[] {
  const newest = new Map<string, RecentAttachment>();
  for (const task of tasks) {
    for (const run of task.runs) {
      const at = Date.parse(run.createdAt);
      for (const file of run.snapshot.input.files) {
        const known = newest.get(file.id);
        if (!known || known.at < at) newest.set(file.id, { file, at, source: task.title });
      }
    }
  }
  return [...newest.values()].sort((a, b) => b.at - a.at).slice(0, RECENT_ATTACHED_LIMIT);
}

function locationLabel(location: string): string {
  if (location === ICLOUD || location.startsWith(`${ICLOUD}/`)) return location;
  return location ? `~/${location}` : '~';
}

/** A searched file's chip, which names where it lives so files of the same name stay distinct. */
function searchedChip(file: FileRef, result: FileSearchResult): FileChip {
  return { kind: 'file', file, location: locationLabel(result.location) };
}

/**
 * The `@` file sources (plan 1.9): recently attached and recently modified files for an empty
 * query, system search matches for a query, and the "Browse files…" row, which the list keeps
 * last and which reuses the system picker to insert one chip per chosen file, of any format. When
 * the system search is off, failed, or still indexing without a match, the "Browse files…" row
 * says why. Rows keep the index's order; they grey out, with the reason, for files over the
 * attachment size limit (`MAX_ATTACHMENT_BYTES`) and once the draft already carries ten
 * attachments. While a pick uploads, further picks are ignored rather than disabled, so the
 * active row does not jump.
 */
export function useFileGroups({
  enabled,
  live,
  query,
  editor,
  tasks,
  attachmentCount,
}: {
  enabled: boolean;
  /** The panel is open; only then does the file search run. */
  live: boolean;
  query: string;
  editor: ComposerEditorCommands;
  tasks: readonly AgentTask[];
  attachmentCount: number;
}): {
  lists: QuickGroup[];
  browse: QuickGroup;
  /** The search has not answered this query yet. */
  loading: boolean;
  /**
   * Matches may still come without more typing (the index is being built or reopened), so "no
   * matches" would be premature.
   */
  settling: boolean;
} | null {
  const { t, i18n } = useTranslation('panel');
  const [busy, setBusy] = useState<string | null>(null);
  const search = useFileSearch(live, query);
  if (!enabled) return null;
  const language = i18n.resolvedLanguage ?? i18n.language;
  const full = attachmentCount >= ATTACHMENT_LIMIT;
  const limitReason = t('quickPanel.files.limit');

  /** Inserts the chips a row loads; one pick runs at a time, and a failure shows its toast. */
  function pick(id: string, load: () => Promise<FileChip[]>) {
    if (busy !== null) return;
    setBusy(id);
    void load()
      .then((chips) => {
        if (attachmentCount + chips.length > ATTACHMENT_LIMIT)
          throw new Error(t('composer.attachLimit'));
        if (chips.length) editor.insertChips(chips);
      })
      .catch(showErrorToast)
      .then(() => setBusy(null));
  }

  const attached = query
    ? []
    : recentAttachments(tasks).map(({ file, at, source }): QuickOption => ({
        value: `attached:${file.id}`,
        icon: <Paperclip />,
        title: file.name,
        // The pick reuses the stored copy by id, so the row names that copy's origin; a message
        // sent with it carries the file's current content when its source changed since
        // (agent-service resources/refresh.ts), as a picked or dropped file does.
        description: full
          ? limitReason
          : t('quickPanel.files.attachedFrom', {
              size: fileSize(file.size),
              conversation: source.replace(/\s+/g, ' ').trim(),
            }),
        status: relativeTime(at, language),
        disabled: full,
        select: () => editor.insertChips([{ kind: 'file', file }]),
      }));
  const results =
    search.status !== 'ready'
      ? []
      : search.results.map((result): QuickOption => {
          const Icon = result.kind ? FILE_KIND_ICONS[result.kind] : File;
          const reason = full
            ? limitReason
            : result.reason === 'tooLarge'
              ? t('quickPanel.files.tooLarge')
              : undefined;
          return {
            // Stable across replies on this channel, so the active row survives a new reply.
            value: `file:${result.resultId}`,
            icon: <Icon />,
            title: result.name,
            // The index marks and ranks the matches; the score only places this group among the
            // others.
            ranges: result.match ? { title: result.match } : undefined,
            score: matchFields(query, { name: result.name })?.score,
            description: reason ?? locationLabel(result.location),
            status:
              busy === result.resultId
                ? t('quickPanel.files.attaching')
                : result.modifiedAt === null
                  ? undefined
                  : relativeTime(result.modifiedAt, language),
            disabled: full || !result.attachable,
            select: () =>
              pick(result.resultId, async () => {
                const files = await search.attach([result.resultId]);
                return files.map((file) => searchedChip(file, result));
              }),
          };
        });
  const coverage = search.status === 'ready' ? search.coverage : 'complete';
  const notice =
    coverage === 'partial'
      ? t('quickPanel.files.partial')
      : coverage === 'indexing'
        ? t('quickPanel.files.indexingMore')
        : undefined;
  // Without the desktop bridge nothing here works, so there is no reason worth showing.
  const searchOff =
    search.status === 'unavailable' && search.reason !== 'desktop'
      ? t(`quickPanel.files.${search.reason}`)
      : undefined;
  // With no row to carry the notice, the "Browse files…" row tells why files may be missing.
  const shortfall =
    results.length || coverage === 'complete' ? undefined : t(`quickPanel.files.${coverage}`);
  const settling =
    (coverage === 'indexing' && results.length === 0) ||
    (search.status === 'unavailable' && search.reason === 'retrying');
  const browse: QuickOption = {
    value: 'files:browse',
    icon: <FolderOpen />,
    title: t('quickPanel.files.browse'),
    description: full
      ? limitReason
      : (searchOff ?? shortfall ?? t('quickPanel.files.browseDescription')),
    disabled: full,
    select: () =>
      pick('browse', async () => {
        const { resources, failures } = await agentApi().chooseFiles();
        reportImportFailures(failures, t);
        return resources.map((file): FileChip => ({ kind: 'file', file }));
      }),
  };
  return {
    lists: [
      {
        id: 'files:attached',
        heading: t('quickPanel.groups.recentAttached'),
        icon: <Paperclip />,
        options: attached,
      },
      {
        id: query ? 'files:search' : 'files:recent',
        heading: query ? t('quickPanel.groups.files') : t('quickPanel.groups.recentModified'),
        icon: query ? <FileSearch /> : <History />,
        notice,
        options: results,
      },
    ],
    browse: { id: 'files:browse', options: [browse] },
    loading: search.status === 'loading',
    settling,
  };
}
