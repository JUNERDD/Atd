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
import type { TFunction } from 'i18next';
import { commandFilter } from '@ai/ui/lib/command-filter';
import type { AgentTask, FileRef } from '../../../electron/agent/task-schema';
import type { FileSearchResult } from '../../../electron/file-search/contract';
import { showErrorToast } from '../../components/toast-store';
import { agentApi } from '../agent/use-agent';
import type { ComposerEditorCommands } from '../composer-editor/editor-commands';
import type { QuickGroup, QuickOption } from './quick-options';
import { relativeTime } from './relative-time';
import { useFileSearch, type FileSearchState } from './use-file-search';

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

/**
 * Files that earlier runs attached, newest first and once per resource id. The service keeps
 * uploaded resources, so a pick reuses the `FileRef` as is and never reads the file again.
 */
function recentAttachments(tasks: readonly AgentTask[]): { file: FileRef; at: number }[] {
  const newest = new Map<string, { file: FileRef; at: number }>();
  for (const task of tasks) {
    for (const run of task.runs) {
      const at = Date.parse(run.createdAt);
      for (const file of run.snapshot.input.files) {
        const known = newest.get(file.id);
        if (!known || known.at < at) newest.set(file.id, { file, at });
      }
    }
  }
  return [...newest.values()].sort((a, b) => b.at - a.at).slice(0, RECENT_ATTACHED_LIMIT);
}

function locationLabel(location: string): string {
  if (location === ICLOUD || location.startsWith(`${ICLOUD}/`)) return location;
  return location ? `~/${location}` : '~';
}

function matchRange(name: string, query: string): readonly [number, number] | undefined {
  const index = query ? name.toLowerCase().indexOf(query.toLowerCase()) : -1;
  return index < 0 ? undefined : [index, index + query.length];
}

function searchNotice(search: FileSearchState, query: string, t: TFunction<'panel'>) {
  if (search.status === 'loading') return t('quickPanel.states.loading');
  if (search.status === 'unavailable') {
    if (search.reason === 'desktop') return t('quickPanel.states.desktopOnly');
    return t(`quickPanel.files.${search.reason}`);
  }
  if (search.partial) return t('quickPanel.files.partial');
  if (search.results.length) return undefined;
  return query ? t('quickPanel.files.none') : t('quickPanel.files.noRecent');
}

/**
 * The `@` file sources (plan 1.9): recently attached and recently used files for an empty query,
 * system search matches for a query, and the "Browse files…" row, which the list keeps last and
 * which reuses the system picker to insert one chip per chosen file. Rows grey out, with the
 * reason, for files over 1 MB and once the draft already carries ten attachments. While a pick
 * uploads, further picks are ignored rather than disabled, so the active row does not jump.
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
}): { lists: QuickGroup[]; browse: QuickGroup } | null {
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
    : recentAttachments(tasks).map(({ file, at }): QuickOption => ({
        value: `attached:${file.id}`,
        icon: <Paperclip />,
        title: file.name,
        description: full ? limitReason : undefined,
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
            match: matchRange(result.name, query),
            // Main ranks the matches; the score only places this group among the others.
            score: query ? commandFilter(result.name, query) : undefined,
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
  const browse: QuickOption = {
    value: 'files:browse',
    icon: <FolderOpen />,
    title: t('quickPanel.files.browse'),
    description: full ? limitReason : t('quickPanel.files.browseDescription'),
    disabled: full,
    select: () => void pick('browse', () => agentApi().chooseFiles()),
  };
  return {
    lists: [
      { id: 'files:attached', heading: t('quickPanel.groups.recentAttached'), options: attached },
      {
        id: query ? 'files:search' : 'files:recent',
        heading: query ? t('quickPanel.groups.files') : t('quickPanel.groups.recentUsed'),
        notice: searchNotice(search, query, t),
        options: results,
      },
    ],
    browse: { id: 'files:browse', options: [browse] },
  };
}
