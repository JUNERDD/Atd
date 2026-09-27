import type { ComponentProps, ReactNode, Ref, RefCallback, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@ai/ui/components/command';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { Popover, PopoverContent } from '@ai/ui/components/popover';
import { visibleGroups, type QuickOption, type QuickView } from './quick-options';
import { useQuickPanel, type QuickPanelAria, type QuickPanelHandle } from './use-quick-panel';
import './quick-panel.css';

/**
 * Where an editor places its panel; everything else about the surface is shared. `className`
 * carries the shared `quick-panel-content p-0` material plus any editor-specific cap.
 */
export type QuickPanelPlacement = Pick<
  ComponentProps<typeof PopoverContent>,
  | 'side'
  | 'sideOffset'
  | 'collisionBoundary'
  | 'avoidCollisions'
  | 'hideWhenDetached'
  | 'updatePositionStrategy'
  | 'className'
>;

export interface QuickPanelSurfaceProps {
  open: boolean;
  /** The rows to show; the owning editor builds them for its trigger. */
  view: QuickView;
  /** What Enter does to the active row, as the footer hint says. */
  enterHint: 'use' | 'insert';
  /** Closes the panel for the current trigger token (Esc, or a dismissal by Radix). */
  onDismiss: () => void;
  handleRef: Ref<QuickPanelHandle>;
  /** Combobox wiring for the editor content; null while closed. */
  onAriaChange: (aria: QuickPanelAria | null) => void;
  /** The `PopoverAnchor` (or anchored element) the panel positions against. */
  anchor: ReactNode;
  /** The editor's element: clicks in it move the caret, and the trigger under it decides. */
  owner: RefObject<Element | null>;
  placement: QuickPanelPlacement;
}

/**
 * The `@` / `/` panel surface shared by every editor with chips (plan 1.4). Focus never leaves
 * the editor: it forwards ↑ ↓ Enter Tab through `handleRef`, the content refuses focus (no
 * auto-focus, mousedown cancelled), and Esc closes the panel in Radix's dismissable layer before
 * any outer Esc handler sees it.
 */
export function QuickPanelSurface({
  open,
  view,
  enterHint,
  onDismiss,
  handleRef,
  onAriaChange,
  anchor,
  owner,
  placement,
}: QuickPanelSurfaceProps) {
  const { t } = useTranslation('panel');
  const groups = visibleGroups(view.groups);
  // Only the trailing "Browse files…" group has no heading; it is an action, not a result.
  const empty = groups.some((group) => group.heading !== undefined) ? null : view.empty;
  const { activeValue, hover, setList, trackOption } = useQuickPanel({
    open,
    groups,
    handleRef,
    onAriaChange,
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {anchor}
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={8}
        {...placement}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (!event.isComposing) onDismiss();
        }}
        onInteractOutside={(event) => {
          // Clicks in the editor move the caret; the trigger under it decides whether to stay open.
          if (event.target instanceof Node && owner.current?.contains(event.target))
            event.preventDefault();
        }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Command
          shouldFilter={false}
          value={activeValue}
          onValueChange={hover}
          className="min-h-0 bg-transparent"
        >
          <CommandList
            ref={setList}
            label={t('quickPanel.listLabel')}
            className="max-h-none min-h-0 flex-1"
          >
            {empty !== null && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">{empty}</p>
            )}
            {groups.flatMap((group, index) => [
              // The heading-less "Browse files…" group is set apart from whatever precedes it.
              !group.heading && (index > 0 || empty !== null) && (
                <CommandSeparator key={`${group.id}:rule`} alwaysRender />
              ),
              <CommandGroup
                key={group.id}
                value={group.id}
                heading={
                  group.heading === undefined ? undefined : (
                    <HighlightedText text={group.heading} ranges={group.headingRanges} />
                  )
                }
              >
                {group.notice && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{group.notice}</p>
                )}
                {group.options.map((option) => (
                  <QuickRow key={option.value} option={option} track={trackOption(option.value)} />
                ))}
              </CommandGroup>,
            ])}
          </CommandList>
          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <KbdGroup>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </KbdGroup>
              {t('quickPanel.hints.choose')}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>Enter</Kbd>
              {enterHint === 'use' ? t('quickPanel.hints.use') : t('quickPanel.hints.insert')}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Kbd>Esc</Kbd>
              {t('quickPanel.hints.close')}
            </span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Icon, title and one-line secondary text (query matches emphasized), trailing status. */
function QuickRow({
  option,
  track,
}: {
  option: QuickOption;
  /** Registers the option element so its id can become `aria-activedescendant`. */
  track: RefCallback<HTMLDivElement>;
}) {
  return (
    <CommandItem
      ref={track}
      value={option.value}
      disabled={option.disabled}
      data-checked={option.checked}
      onSelect={option.select}
    >
      {option.icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={option.title}>
          <HighlightedText text={option.title} ranges={option.ranges?.title} />
        </span>
        {option.description && (
          <span className="truncate text-xs text-muted-foreground" title={option.description}>
            <HighlightedText text={option.description} ranges={option.ranges?.description} />
          </span>
        )}
      </span>
      {/* The item's trailing slot: it replaces the hidden check, so statuses sit flush right. */}
      {option.status && (
        <CommandShortcut
          className="max-w-2/5 shrink-0 truncate tracking-normal"
          title={option.status}
        >
          {option.status}
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
