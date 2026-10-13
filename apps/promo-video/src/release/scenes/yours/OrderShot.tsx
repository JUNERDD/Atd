import { FileText, Languages, Pencil, Plus, Terminal, type LucideIcon } from 'lucide-react';
import type { Lang } from '../../../copy.ts';
import {
  CommandRow,
  COMMAND_ROW_PITCH,
  type CommandRowData,
} from '../../../kit/product/settings/CommandRow.tsx';
import { commandRowHold } from '../../../kit/product/settings/command-row.ts';
import { PrimaryButton, SearchField } from '../../../kit/product/settings/controls.tsx';
import { SettingsWindow } from '../../../kit/product/settings/SettingsWindow.tsx';
import { strings } from '../../../kit/product/strings.ts';
import { Cursor } from '../../../kit/world/Cursor.tsx';
import { cursorAt, type CursorState } from '../../../kit/world/cursor.ts';
import { clamp01 } from '../../../motion/ease.ts';
import { springAt, springs } from '../../../motion/spring.ts';
import { DRAG_ROWS, dragProgress, makeWayTimes, YOURS_BEATS } from './beats.ts';
import { orderCamera } from './cameras.ts';
import { content } from './content.ts';
import { ORDER_BOX, ORDER_FROM, ORDER_GRIP } from './layout.ts';
import { ShotLayer } from './ShotLayer.tsx';

const B = YOURS_BEATS.order;
/** The rows' marks, as `command-icon.tsx` picks them by starter template (others: Terminal). */
const ICONS: readonly LucideIcon[] = [Pencil, FileText, Terminal, Languages, Terminal];
/** On release the lift's shadow falls back over the same 230 ms it rose in. */
const SHADOW_FALL = 0.23;
const MAKE_WAY = makeWayTimes();

/** The dragged row's offset from its slot, in points (up is negative). */
function dragOffset(t: number): number {
  return -DRAG_ROWS * COMMAND_ROW_PITCH * dragProgress(t);
}

/** The pointer: it arrives and presses the row, then rides with it until the drop. */
function pointer(t: number): CursorState {
  const arrive = cursorAt(t, [
    { at: B.in, x: ORDER_GRIP.x + 140, y: ORDER_GRIP.y + 120 },
    { at: B.press, x: ORDER_GRIP.x, y: ORDER_GRIP.y, travel: 0.32 },
  ]);
  if (t < B.press) return arrive;
  const held = t < B.drop;
  const dt = 1 / 120;
  const vy = (dragOffset(t + dt) - dragOffset(t - dt)) / (2 * dt);
  const pressed = held ? clamp01((t - B.press) / 0.06) : 1 - clamp01((t - B.drop) / 0.06);
  return {
    x: ORDER_GRIP.x,
    y: ORDER_GRIP.y + dragOffset(t),
    kind: 'arrow',
    pressed,
    scale: 1 - 0.1 * pressed,
    vx: 0,
    vy,
    speed: Math.abs(vy),
  };
}

/** Each row's offset from its slot: the dragged one with the pointer, the passed ones down a slot. */
function offsetOf(index: number, t: number): number {
  if (index === ORDER_FROM) return dragOffset(t);
  const passed = ORDER_FROM - index;
  const at = passed >= 1 && passed <= DRAG_ROWS ? MAKE_WAY[passed - 1] : undefined;
  return at === undefined ? 0 : COMMAND_ROW_PITCH * springAt(t, at, springs.snappy);
}

/**
 * Bar 16 · Settings → Commands. The pointer presses "Translate": the shadow rises, the row lifts
 * at 350 ms, is dragged up two places while the rows it passes slide down to make way, and is
 * dropped on beat 3, its shadow falling back as the new order is saved.
 */
export function OrderShot({ t, lang, opacity }: { t: number; lang: Lang; opacity: number }) {
  const st = strings[lang].settings;
  const rows: CommandRowData[] = content[lang].commands.map((command, index) => ({
    icon: ICONS[index] ?? Terminal,
    name: command.name,
    description: command.description,
    keys: command.keys,
    enabled: true,
  }));
  const held = t < B.drop;
  const hold = held ? commandRowHold(t - B.press) : { shadow: 0, lifted: false };
  const fall = held ? 1 : 1 - clamp01((t - B.drop) / SHADOW_FALL);
  return (
    <ShotLayer state={orderCamera(t)} opacity={opacity}>
      <SettingsWindow lang={lang} box={ORDER_BOX} section="commands">
        <div className="r08-yours-list">
          <p className="r08-yours-list__description">{st.commands.description}</p>
          <div className="r08-yours-list__toolbar">
            <SearchField placeholder={st.commands.searchPlaceholder} />
            <PrimaryButton icon={Plus} label={st.commands.new} />
          </div>
          <p className="r08-yours-list__hint">{st.commands.reorderHint}</p>
          <div className="r08-yours-rows">
            {rows.map((row, index) => {
              const dragged = index === ORDER_FROM;
              return (
                <div
                  key={row.name}
                  className="r08-yours-rows__slot"
                  data-dragged={dragged || undefined}
                  style={{ '--slot': index, '--dy': offsetOf(index, t) }}
                >
                  <CommandRow
                    command={row}
                    emptyShortcut={st.commands.setShortcut}
                    hover={dragged && t >= B.press - 0.1}
                    shadow={dragged ? (held ? hold.shadow : fall) : 0}
                    lifted={dragged && hold.lifted}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </SettingsWindow>
      <Cursor state={pointer(t)} />
    </ShotLayer>
  );
}
