import { useTranslation } from 'react-i18next';
import { BookOpen, Bot, FileText, MessageSquare, Plug, type LucideIcon } from 'lucide-react';
import { chipName, type Chip } from './draft';

/** Same marks as the extension settings (skills, subagents, MCP) and the transcript file rows. */
const ICONS: Record<Chip['kind'], LucideIcon> = {
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
 * tooltip repeats it because long names are truncated.
 */
export function ChipContent({ chip }: { chip: Chip }) {
  const { t } = useTranslation('panel');
  const Icon = ICONS[chip.kind];
  const name = chipName(chip);
  const label = t(LABEL_KEYS[chip.kind], { name });
  return (
    <>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" title={label}>
        <Icon className="composer-chip-icon" />
        <span className="composer-chip-name">{name}</span>
      </span>
    </>
  );
}
