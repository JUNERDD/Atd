import { useState } from 'react';
import {
  FileBraces,
  FileCode,
  FileText,
  FolderOpen,
  Paperclip,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import type { AgentTask, FileRef } from '../../../electron/agent/task-schema';
import type { FileSearchResult } from '../../../electron/file-search/contract';
import { showErrorToast } from '../../components/toast-store';
import { fileSize } from '../../lib/task-store';
import { agentApi } from '../agent/use-agent';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import type { QuickGroup, QuickOption } from './quick-options';
import { relativeTime } from './relative-time';
import { useFileSearch } from './use-file-search';

/** Run input limit (`InputSchema.files`), counted over the attachment row and file chips together. */
const ATTACHMENT_LIMIT = 10;
const RECENT_ATTACHED_LIMIT = 3;
const KIND_ICONS: Record<FileSearchResult['kind'], LucideIcon> = {
  text: FileText,
  code: FileCode,
  data: FileBraces,
};
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

/**
 * The `@` file sources (plan 1.9): recently attached and recently used files for an empty query,
 * system search matches for a query, and the "Browse files…" row, which the list keeps last and
 * which reuses the system picker to insert one chip per chosen file. When the system search is
 * off or failed, the "Browse files…" row says why. Rows grey out, with the reason, for files over
 * 1 MB and once the draft already carries ten attachments. While a pick uploads, further picks are
 * ignored rather than disabled, so the active row does not jump.
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
} | null {
  const { t, i18n } = useTranslation('panel');
  const [busy, setBusy] = useState<string | null>(null);
  const search = useFileSearch(live, query);
  if (!enabled) return null;
  const language = i18n.resolvedLanguage ?? i18n.language;
  const full = attachmentCount >= ATTACHMENT_LIMIT;
  const limitReason = t('quickPanel.files.limit');

  async function pick(id: string, load: () => Promise<FileRef[]>) {
    if (busy !== null) return;
    setBusy(id);
    try {
      const files = await load();
      if (attachmentCount + files.length > ATTACHMENT_LIMIT)
        throw new Error(t('composer.attachLimit'));
      if (files.length) editor.insertChips(files.map((file) => ({ kind: 'file', file })));
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  const attached = query
    ? []
    : recentAttachments(tasks).map(({ file, at, source }): QuickOption => ({
        value: `attached:${file.id}`,
        icon: <Paperclip />,
        title: file.name,
        // The pick reuses the stored copy, not a path on disk, so the row names that copy's origin.
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
          const Icon = KIND_ICONS[result.kind];
          const reason = full
            ? limitReason
            : result.reason === 'tooLarge'
              ? t('quickPanel.files.tooLarge')
              : undefined;
          // Recent files sort by last use, matches by last change; either may be unknown.
          const at =
            result.source === 'recent'
              ? (result.usedAt ?? result.modifiedAt)
              : (result.modifiedAt ?? result.usedAt);
          return {
            value: `file:${result.resultId}`,
            icon: <Icon />,
            title: result.name,
            // Main marks and ranks the matches; the score only places this group among the others.
            ranges: result.match ? { title: result.match } : undefined,
            score: matchFields(query, { name: result.name })?.score,
            description: reason ?? locationLabel(result.location),
            status:
              busy === result.resultId
                ? t('quickPanel.files.attaching')
                : at === null
                  ? undefined
                  : relativeTime(at, language),
            disabled: full || !result.attachable,
            select: () => void pick(result.resultId, () => search.attach([result.resultId])),
          };
        });
  // Without the desktop bridge nothing here works, so there is no reason worth showing.
  const searchOff =
    search.status === 'unavailable' && search.reason !== 'desktop'
      ? t(`quickPanel.files.${search.reason}`)
      : undefined;
  const browse: QuickOption = {
    value: 'files:browse',
    icon: <FolderOpen />,
    title: t('quickPanel.files.browse'),
    description: full ? limitReason : (searchOff ?? t('quickPanel.files.browseDescription')),
    disabled: full,
    select: () => void pick('browse', () => agentApi().chooseFiles()),
  };
  return {
    lists: [
      { id: 'files:attached', heading: t('quickPanel.groups.recentAttached'), options: attached },
      {
        id: query ? 'files:search' : 'files:recent',
        heading: query ? t('quickPanel.groups.files') : t('quickPanel.groups.recentUsed'),
        notice:
          search.status === 'ready' && search.partial ? t('quickPanel.files.partial') : undefined,
        options: results,
      },
    ],
    browse: { id: 'files:browse', options: [browse] },
    loading: search.status === 'loading',
  };
}
