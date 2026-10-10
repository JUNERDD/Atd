import { Search, Wifi } from 'lucide-react';
import { StatusItem, type StatusState } from './StatusItem.tsx';
import './menu-bar.css';

/** An apple silhouette for the Apple menu (after Simple Icons' "apple", CC0). */
const APPLE =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

function Battery() {
  return (
    <svg className="menu-bar__glyph" data-glyph="battery" viewBox="0 0 27 13" aria-hidden="true">
      <rect
        className="menu-bar__battery-case"
        x="0.75"
        y="0.75"
        width="22.5"
        height="11.5"
        rx="3.4"
      />
      <rect x="2.6" y="2.6" width="16.4" height="7.8" rx="1.8" />
      <path className="menu-bar__battery-cap" d="M24.6 4.4c1 .3 1.6 1.1 1.6 2.1s-.6 1.8-1.6 2.1Z" />
    </svg>
  );
}

function ControlCenter() {
  return (
    <svg className="menu-bar__glyph" data-glyph="control" viewBox="0 0 16 14" aria-hidden="true">
      <rect className="menu-bar__toggle" x="0.7" y="0.7" width="14.6" height="5.6" rx="2.8" />
      <circle cx="12.5" cy="3.5" r="1.9" />
      <rect className="menu-bar__toggle" x="0.7" y="7.7" width="14.6" height="5.6" rx="2.8" />
      <circle cx="3.5" cy="10.5" r="1.9" />
    </svg>
  );
}

export interface MenuBarProps {
  /** The frontmost app's name, set bold after the Apple menu. Default "Finder". */
  appName?: string;
  /** Its menus. Default: Finder's. */
  menus?: readonly string[];
  /** Atd's status item. Default `idle`. */
  status?: StatusState;
  /** The status badge's scale, 0–1 (see `StatusItem`). */
  statusBadge?: number;
  /** Highlights the status item, as when its menu or the panel is open from it. */
  statusOpen?: boolean;
  /** The clock, as the menu bar shows it (e.g. "Fri Oct 10  9:41"). */
  clock: string;
}

/**
 * The macOS 26 menu bar, in points: translucent over the wallpaper, the Apple menu, the app's name
 * and menus on the left; on the right Atd's status item, the system's items and the clock.
 */
export function MenuBar({
  appName = 'Finder',
  menus = ['File', 'Edit', 'View', 'Go', 'Window', 'Help'],
  status = 'idle',
  statusBadge,
  statusOpen = false,
  clock,
}: MenuBarProps) {
  return (
    <div className="menu-bar">
      <div className="menu-bar__side">
        <svg className="menu-bar__glyph" data-glyph="apple" viewBox="0 0 24 24" aria-hidden="true">
          <path d={APPLE} />
        </svg>
        <span className="menu-bar__app">{appName}</span>
        {menus.map((menu) => (
          <span key={menu} className="menu-bar__menu">
            {menu}
          </span>
        ))}
      </div>
      <div className="menu-bar__side" data-side="right">
        <span className="menu-bar__status" data-open={statusOpen ? '' : undefined}>
          <StatusItem
            state={status}
            {...(statusBadge === undefined ? {} : { badge: statusBadge })}
          />
        </span>
        <Battery />
        <Wifi className="menu-bar__icon" size={16} strokeWidth={2.3} />
        <Search className="menu-bar__icon" size={15} strokeWidth={2.4} />
        <ControlCenter />
        <span className="menu-bar__clock">{clock}</span>
      </div>
    </div>
  );
}
