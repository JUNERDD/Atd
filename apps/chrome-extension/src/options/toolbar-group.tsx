import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolbarAction } from '../messages/settings.ts';
import type { OptionsView } from '../messages/views.ts';
import { Group, Row } from './group.tsx';
import type { SendOption } from './use-options-channel.ts';

/** The choices in the order the pop-up lists them: the default first. */
const ACTIONS: readonly ToolbarAction[] = ['ask', 'panel'];

const ACTION_KEYS = {
  ask: 'toolbar.ask',
  panel: 'toolbar.panel',
} as const satisfies Record<ToolbarAction, string>;

/**
 * The toolbar button's click, as a Mac pop-up button: the current choice and the up and down
 * chevrons, opening a menu of the choices with the current one checked. The kit's menu script
 * anchors the menu to the button and adds the keyboard (arrows, Home, End, type-ahead; Esc closes
 * it). The pop-up shows the person's choice at once and follows the background again as soon as
 * its setting changes; a choice that could not be sent is not shown. Unavailable (dimmed, never
 * hidden) where the browser has no side panel: the footer it points at says why.
 */
function ToolbarPicker({
  action,
  available,
  labelId,
  noteId,
  send,
}: {
  action: ToolbarAction;
  available: boolean;
  labelId: string;
  noteId: string;
  send: SendOption;
}) {
  const { t } = useTranslation('options');
  const menuId = useId();
  const valueId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [choice, setChoice] = useState<{ from: ToolbarAction; to: ToolbarAction } | null>(null);
  // Once the background has moved on, its setting is the truth again.
  if (choice && choice.from !== action) setChoice(null);
  const shown = choice?.to ?? action;
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    // Again whenever the button becomes its invoker: the script binds the invokers it finds.
    window.AppleBlocks.menu.init(element);
    if (!available && element.matches(':popover-open')) element.hidePopover();
  }, [available]);
  // The kit's script checks a chosen item itself; when the choice could not be sent, the items are
  // drawn again from the shown value so the menu never keeps a check the page does not show.
  const [redraw, setRedraw] = useState(0);
  const choose = (value: ToolbarAction) => {
    if (!available || value === shown) return;
    if (send({ type: 'toolbarAction.set', action: value }))
      setChoice(value === action ? null : { from: action, to: value });
    else setRedraw((count) => count + 1);
  };
  return (
    <>
      <button
        type="button"
        className="btn-bordered op-btn op-popup hit-extend"
        popoverTarget={available ? menuId : undefined}
        aria-haspopup="menu"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={noteId}
        aria-disabled={!available}
      >
        <span id={valueId}>{t(ACTION_KEYS[shown])}</span>
        <ChevronsUpDown aria-hidden="true" />
      </button>
      <div
        ref={menu}
        id={menuId}
        className="menu motion-pop op-menu"
        popover="auto"
        role="menu"
        aria-labelledby={labelId}
      >
        {ACTIONS.map((value) => (
          <button
            key={`${value}:${redraw}`}
            type="button"
            className="menu__item op-menu-item"
            role="menuitemradio"
            aria-checked={value === shown}
            onClick={() => choose(value)}
          >
            {t(ACTION_KEYS[value])}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * What a click on the toolbar button does (`ExtensionSettings.toolbarAction`). The choice exists
 * only with Chrome's side panel: in a browser without one, the button always opens the panel in
 * its toolbar popup.
 */
export function ToolbarGroup({ view, send }: { view: OptionsView; send: SendOption }) {
  const { t } = useTranslation('options');
  const labelId = useId();
  const noteId = useId();
  const available = view.panel === 'sidePanel';
  return (
    <Group
      title={t('toolbar.heading')}
      footer={
        <p className="list-footer" id={noteId}>
          {available ? t('toolbar.footer') : t('toolbar.footerPopup')}
        </p>
      }
    >
      <Row label={t('toolbar.label')} labelId={labelId}>
        <ToolbarPicker
          action={view.settings.toolbarAction}
          available={available}
          labelId={labelId}
          noteId={noteId}
          send={send}
        />
      </Row>
    </Group>
  );
}
