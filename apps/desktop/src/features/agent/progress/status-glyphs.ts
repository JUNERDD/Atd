import {
  CircleCheck,
  CircleSlash,
  CircleX,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldAlert,
} from 'lucide-react';

/**
 * A state as its row's leading glyph, in the Todos list's glyph style: the pill's HITL icons while
 * a request of it waits, a spinner while it runs, then its outcome. The subagent list and the side
 * chat list draw a state alike; `label` is the state's name in the `tasks` namespace, for the
 * accessible name, and `word` its short form, which the row shows under its name. The key order
 * is the lists' order: what needs the reader first, then working, then settled.
 */
export const STATUS_GLYPHS = {
  approval: {
    Icon: ShieldAlert,
    className: '',
    label: 'permission.waitingApproval',
    word: 'statusList.approval',
  },
  answer: {
    Icon: MessageCircleQuestion,
    className: '',
    label: 'permission.waitingAnswer',
    word: 'statusList.answer',
  },
  running: {
    Icon: LoaderCircle,
    className: 'animate-spin',
    label: 'activity.running',
    word: 'statusList.running',
  },
  failed: {
    Icon: CircleX,
    className: 'text-destructive',
    label: 'activity.failed',
    word: 'statusList.failed',
  },
  interrupted: {
    Icon: CircleSlash,
    className: 'text-muted-foreground',
    label: 'activity.interrupted',
    word: 'statusList.interrupted',
  },
  completed: {
    Icon: CircleCheck,
    className: 'text-muted-foreground',
    label: 'activity.completed',
    word: 'statusList.completed',
  },
} as const;
export type StatusGlyph = keyof typeof STATUS_GLYPHS;
export const STATUS_ORDER = Object.keys(STATUS_GLYPHS) as StatusGlyph[];
