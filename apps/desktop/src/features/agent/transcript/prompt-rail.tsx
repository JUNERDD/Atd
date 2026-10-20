import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@atd/ui/components/command';
import { Kbd, KbdGroup } from '@atd/ui/components/kbd';
import { Popover, PopoverAnchor, PopoverContent } from '@atd/ui/components/popover';
import { isComposingKey } from '@atd/ui/lib/ime';
import { acceleratorToHotkey, shortcutKeys } from '../../../lib/shortcuts';
import type { PromptEntry } from './prompt-nav';

/** Ticks the rail draws at most; a longer conversation shows the stretch around the current one. */
const MAX_TICKS = 24;
/** How long the pointer rests on the rail before the list opens. */
const OPEN_DELAY_MS = 150;
/** How long the pointer has to cross between the rail and the open list before it closes. */
const CLOSE_DELAY_MS = 200;
/** From this many messages the list offers a filter field. */
const FILTER_FROM = 9;
const PREVIOUS = 'Alt+CommandOrControl+Up';
const NEXT = 'Alt+CommandOrControl+Down';

/** Like the panel's own keys: heard in the composer too, once per press. */
const STEP_KEYS: Options = {
  delimiter: '|',
  useKey: false,
  enableOnFormTags: true,
  enableOnContentEditable: true,
  preventDefault: true,
  ignoreEventWhen: (event) => event.defaultPrevented || event.repeat || isComposingKey(event),
};

/** Matches the filter against a message's words, never its turn id (the item's value). */
function filterByLabel(_value: string, search: string, keywords: string[] = []): number {
  return keywords.join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()) ? 1 : 0;
}

/** The ticks the rail draws: every message, or `MAX_TICKS` of them around `current`. */
function tickRange(count: number, current: number) {
  const span = Math.min(count, MAX_TICKS);
  const start = Math.min(Math.max(current - Math.floor(span / 2), 0), count - span);
  return { start, end: start + span };
}

/**
 * The conversation's user messages as a rail of ticks in the transcript's leading gutter, one per
 * message. Ticks keep one length and the current message's only darkens, so the rail never reaches
 * toward the messages. Resting the pointer on the rail opens the list of every message, which
 * stays open while the pointer is over either; clicking or pressing the rail opens it as well, the
 * keyboard's way taking focus into the list. Picking a message shows it (`onShow`), and the step
 * keys move to the previous or next one (`onStep`) unless the transcript is `covered`.
 */
export function PromptRail({
  prompts,
  active,
  covered,
  viewportRef,
  onShow,
  onStep,
}: {
  prompts: readonly PromptEntry[];
  active: string | null;
  covered: boolean;
  /** The transcript's scroll viewport, which a wheel over the rail scrolls as if over the text. */
  viewportRef: RefObject<HTMLDivElement | null>;
  onShow: (turnId: string) => void;
  onStep: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation('tasks');
  const platform = window.desktop?.platform ?? 'web';
  const [open, setOpen] = useState(false);
  /** The list was opened from the keyboard: it takes focus, and gives it back to the rail. */
  const [typed, setTyped] = useState(false);
  const [highlight, setHighlight] = useState('');
  const rail = useRef<HTMLButtonElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The keys stay bound across renders; each press steps with the latest handler.
  const step = useRef(onStep);
  useLayoutEffect(() => {
    step.current = onStep;
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  const keys = { ...STEP_KEYS, enabled: !covered };
  useHotkeys(acceleratorToHotkey(PREVIOUS, platform), () => step.current(-1), keys, []);
  useHotkeys(acceleratorToHotkey(NEXT, platform), () => step.current(1), keys, []);

  const current = prompts.findIndex((entry) => entry.turnId === active);
  const { start, end } = tickRange(prompts.length, current);
  // One hint for both keys: their shared modifiers, then each arrow.
  const modifiers = shortcutKeys(PREVIOUS, platform).slice(0, -1);
  const arrows = [PREVIOUS, NEXT].flatMap((accelerator) =>
    shortcutKeys(accelerator, platform).slice(-1),
  );

  function later(action: () => void, delay: number) {
    clearTimeout(timer.current);
    timer.current = setTimeout(action, delay);
  }
  function enter() {
    if (open) clearTimeout(timer.current);
    else later(() => show(false), OPEN_DELAY_MS);
  }
  function show(fromKeyboard: boolean) {
    clearTimeout(timer.current);
    setTyped(fromKeyboard);
    if (!open) setHighlight(active ?? '');
    setOpen(true);
  }
  function hide() {
    clearTimeout(timer.current);
    setOpen(false);
  }
  function leave() {
    if (open && !typed) later(hide, CLOSE_DELAY_MS);
    else if (!open) clearTimeout(timer.current);
  }
  function pick(turnId: string) {
    hide();
    onShow(turnId);
  }

  return (
    <div className="prompt-rail-region">
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) hide();
        }}
      >
        <PopoverAnchor asChild>
          <button
            ref={rail}
            type="button"
            className="prompt-rail"
            aria-label={t('transcript.prompts.label', { count: prompts.length })}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-more-above={start > 0 || undefined}
            data-more-below={end < prompts.length || undefined}
            onPointerEnter={enter}
            onPointerLeave={leave}
            // A keyboard press clicks with no pointer detail.
            onClick={(event) => show(event.detail === 0)}
            onWheel={(event) => viewportRef.current?.scrollBy({ top: event.deltaY })}
          >
            {prompts.slice(start, end).map((entry) => (
              <span
                key={entry.turnId}
                className="prompt-rail-tick"
                data-current={entry.turnId === active || undefined}
              />
            ))}
          </button>
        </PopoverAnchor>
        <PopoverContent
          side="right"
          align="center"
          material="backdrop"
          className="prompt-list w-80"
          onPointerEnter={() => clearTimeout(timer.current)}
          onPointerLeave={leave}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (typed) (filter.current ?? list.current)?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (typed) rail.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            // Handled here, so the panel's own Escape does not also step back.
            event.preventDefault();
            hide();
          }}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && rail.current?.contains(event.target))
              event.preventDefault();
          }}
          // A click on a message keeps focus where it was (the composer); the filter takes it.
          onMouseDown={(event) => {
            if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
          }}
        >
          <Command
            ref={list}
            tabIndex={-1}
            label={t('transcript.prompts.listLabel')}
            value={highlight}
            onValueChange={setHighlight}
            filter={filterByLabel}
            className="min-h-0 bg-transparent outline-none"
          >
            {prompts.length >= FILTER_FROM && (
              <CommandInput ref={filter} placeholder={t('transcript.prompts.filter')} />
            )}
            <CommandList scrollShadow>
              <CommandEmpty>{t('transcript.prompts.empty')}</CommandEmpty>
              {prompts.map((entry, index) => (
                <CommandItem
                  key={entry.turnId}
                  value={entry.turnId}
                  keywords={[entry.label]}
                  data-checked={entry.turnId === active}
                  onSelect={() => pick(entry.turnId)}
                >
                  <span className="prompt-list-index">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate" title={entry.label}>
                    {entry.label}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
            <div className="prompt-list-keys">
              <KbdGroup>
                {modifiers.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
              <KbdGroup>
                {arrows.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
              <span>{t('transcript.prompts.step')}</span>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
