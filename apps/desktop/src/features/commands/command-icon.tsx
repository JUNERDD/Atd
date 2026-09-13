import {
  FileText,
  Languages,
  ListTodo,
  Pencil,
  Terminal,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import type { CommandDefinition } from '../../../electron/agent/command-schema';

const templateIcons: Record<string, LucideIcon> = {
  translate: Languages,
  extract: ListTodo,
  polish: Pencil,
  summarize: FileText,
};

export function CommandIcon({
  templateId,
  ...props
}: Pick<CommandDefinition, 'templateId'> & LucideProps) {
  const Icon = templateIcons[templateId ?? ''] ?? Terminal;
  return <Icon aria-hidden="true" {...props} />;
}
