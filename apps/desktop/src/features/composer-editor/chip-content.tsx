import { useTranslation } from 'react-i18next';
import { BookOpen, Bot, FileText, MessageSquare, Plug, type LucideIcon } from 'lucide-react';
import type { Chip } from './draft';
import './chips.css';

export type ChipKind = Chip['kind'];

/** What a chip shows wherever it appears: its kind's icon and its name. */
export interface ChipLabel {
  kind: ChipKind;
  name: string;
}

/** Same marks as the extension settings (skills, subagents, MCP) and the transcript file rows. */
const ICONS: Record<ChipKind, LucideIcon> = {
  file: FileText,
  task: MessageSquare,
  mcpServer: Plug,
  agent: Bot,
  skill: BookOpen,
};

const LABEL_KEYS = {
  file: 'composer.chips.file',
  task: 'composer.chips.task',
  mcpServer: 'composer.chips.mcpServer',
  agent: 'composer.chips.agent',
  skill: 'composer.chips.skill',
} as const;

/**
 * A chip's icon and name. Screen readers get the kind with the name ("File: notes.txt"); the
 * tooltip repeats it because long names are truncated. The spoken label is not selectable, so
 * copying text that spans a chip copies only its visible name.
 */
export function ChipContent({ kind, name }: ChipLabel) {
  const { t } = useTranslation('panel');
  const Icon = ICONS[kind];
  const label = t(LABEL_KEYS[kind], { name });
  return (
    <>
      <span className="sr-only select-none">{label}</span>
      <span aria-hidden="true" title={label}>
        <Icon className="composer-chip-icon" />
        <span className="composer-chip-name">{name}</span>
      </span>
    </>
  );
}

/**
 * A chip outside the editor, such as in a sent message: the same root as `ChipWidget` builds
 * (`span.composer-chip[data-kind]`, inline-block in `chips.css`) around the same content.
 */
export function ChipToken({ kind, name }: ChipLabel) {
  return (
    <span className="composer-chip" data-kind={kind}>
      <ChipContent kind={kind} name={name} />
    </span>
  );
}
