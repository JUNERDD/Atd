import {
  BookOpen,
  Brain,
  Command,
  FileText,
  Folder,
  Image,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';
import { springAt, springs } from '../../motion/spring.ts';
import './tokens.css';
import './chip.css';

/** The composer chip kinds the film shows, with the app's marks (`chip-content.tsx`). */
export type ChipKind = 'file' | 'folder' | 'image' | 'quote' | 'skill' | 'command' | 'memory';

const ICONS: Record<ChipKind, LucideIcon> = {
  file: FileText,
  folder: Folder,
  image: Image,
  quote: TextQuote,
  skill: BookOpen,
  command: Command,
  memory: Brain,
};

export interface ChipProps {
  kind: ChipKind;
  /** The name it shows: a file name, or the quoted passage, cut with an ellipsis past 160 pt. */
  name: string;
  /**
   * Seconds since the chip landed in the draft; it pops in on the `pop` spring. Omit for a chip
   * that is simply there.
   */
  age?: number | undefined;
}

/**
 * A composer chip (`chips.css`): one atom inline in the draft, 20 pt tall, a hairline and the input
 * wash, its kind's 12 pt icon and name in the chip blue. A quote is what the selection toolbar's
 * Ask Atd and Quote in reply insert; an image is a screenshot or a dropped picture.
 */
export function Chip({ kind, name, age }: ChipProps) {
  if (age !== undefined && age < 0) return null;
  const Icon = ICONS[kind];
  const pop = age === undefined ? 1 : springAt(age, 0, springs.snappy);
  return (
    <span
      className="pk-chip"
      style={age === undefined ? undefined : { '--pop': pop, '--o': Math.min(1, pop * 1.6) }}
    >
      <Icon className="pk-icon pk-chip__icon" />
      <span className="pk-chip__name">{name}</span>
    </span>
  );
}

/** The quote chip the selection toolbar puts in the composer: the passage it quotes. */
export function QuoteChip({ text, age }: { text: string; age?: number | undefined }) {
  return <Chip kind="quote" name={text} age={age} />;
}
