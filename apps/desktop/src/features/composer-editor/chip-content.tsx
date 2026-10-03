import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  Bot,
  Brain,
  Command,
  FileText,
  Folder,
  Image,
  MessageSquare,
  Plug,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';
import type { Chip } from './draft';
import './chips.css';

export type ChipKind = Chip['kind'];

/** What a chip shows wherever it appears: its kind's icon and its name. */
export interface ChipLabel {
  kind: ChipKind;
  name: string;
  /** An image file in the composer: an image icon, and a tooltip that clicking edits it. */
  image?: boolean;
  /** The full value the tooltip names instead of `name`, such as a folder's path. */
  detail?: string | undefined;
}

/** Same marks as the extension settings (skills, subagents, MCP) and the transcript file rows. */
const ICONS: Record<ChipKind, LucideIcon> = {
  file: FileText,
  folder: Folder,
  task: MessageSquare,
  mcpServer: Plug,
  agent: Bot,
  skill: BookOpen,
  // The Settings marks for Commands and Memory.
  command: Command,
  memory: Brain,
  // The selection toolbar's Quote in reply action, which inserts this chip.
  quote: TextQuote,
};

const LABEL_KEYS = {
  file: 'composer.chips.file',
  folder: 'composer.chips.folder',
  task: 'composer.chips.task',
  mcpServer: 'composer.chips.mcpServer',
  agent: 'composer.chips.agent',
  skill: 'composer.chips.skill',
  command: 'composer.chips.command',
  memory: 'composer.chips.memory',
  quote: 'composer.chips.quote',
} as const;

/**
 * A chip's icon and name. Screen readers get the kind with the name ("File: notes.txt"); the
 * tooltip repeats it because long names are truncated (with `detail`, the full value: a folder's
 * path), or names the edit an image chip opens. The spoken label is not selectable, so copying
 * text that spans a chip copies only its visible name.
 */
export function ChipContent({ kind, name, image = false, detail }: ChipLabel) {
  const { t } = useTranslation('panel');
  const Icon = image ? Image : ICONS[kind];
  const label = t(LABEL_KEYS[kind], { name });
  const title = image
    ? t('composer.editImage', { name })
    : detail
      ? t(LABEL_KEYS[kind], { name: detail })
      : label;
  return (
    <>
      <span className="sr-only select-none">{label}</span>
      <span aria-hidden="true" title={title}>
        <Icon className="composer-chip-icon" />
        <span className="composer-chip-name">{name}</span>
      </span>
    </>
  );
}

/**
 * A chip outside the editor, such as in a sent message: the same root as `ChipWidget` builds
 * (`span.composer-chip[data-kind]`, inline-block in `chips.css`) around the same content. With
 * `onReveal` (a quote that knows its passage) the root is a button that shows the passage.
 */
export function ChipToken({
  kind,
  name,
  onReveal,
}: ChipLabel & { onReveal?: (() => void) | undefined }) {
  if (onReveal) {
    return (
      <button
        type="button"
        className="composer-chip"
        data-kind={kind}
        data-action="reveal"
        onClick={onReveal}
      >
        <ChipContent kind={kind} name={name} />
      </button>
    );
  }
  return (
    <span className="composer-chip" data-kind={kind}>
      <ChipContent kind={kind} name={name} />
    </span>
  );
}
