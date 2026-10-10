import type { ReactNode } from 'react';
import type { Rect } from './points.ts';
import './mac-window.css';

interface MacWindowProps {
  /** The window's frame on the display, in points. */
  box: Rect;
  title?: string;
  /** Controls at the title bar's trailing end (unified toolbar). */
  toolbar?: ReactNode;
  /**
   * `glass`: the film's Liquid Glass recipe (dark, translucent, blurring the wallpaper);
   * `opaque`: a solid dark-mode window. Default `opaque`.
   */
  material?: 'glass' | 'opaque';
  /** Inactive windows grey their traffic lights and soften their shadow. Default true. */
  focused?: boolean;
  /** A macOS 26 inset sidebar (the traffic lights sit on it); its content, laid out in points. */
  sidebar?: ReactNode;
  /** The sidebar's width, in points. Default 196. */
  sidebarWidth?: number;
  /** The window's content, below the 52 pt title bar (and right of the sidebar, if any). */
  children?: ReactNode;
}

/**
 * A macOS 26 window in points: 16 pt corners, the traffic lights, a unified 52 pt title bar with
 * its title and optional toolbar, an optional inset sidebar, and a glass or opaque body. Position
 * it with `box`; animate it by wrapping it in `Move`.
 */
export function MacWindow({
  box,
  title,
  toolbar,
  material = 'opaque',
  focused = true,
  sidebar,
  sidebarWidth = 196,
  children,
}: MacWindowProps) {
  const hasSidebar = sidebar !== undefined;
  return (
    <div
      className={material === 'glass' ? 'mac-window glass' : 'mac-window'}
      data-glass={material === 'glass' ? 'window' : undefined}
      data-material={material}
      data-focused={focused ? '' : undefined}
      data-sidebar={hasSidebar ? '' : undefined}
      style={{
        '--x': box.x,
        '--y': box.y,
        '--w': box.width,
        '--h': box.height,
        '--sidebar': hasSidebar ? sidebarWidth : 0,
      }}
    >
      {hasSidebar ? <div className="mac-window__sidebar">{sidebar}</div> : null}
      <div className="mac-window__bar">
        <div className="mac-window__lights">
          <span className="mac-window__light" data-light="close" />
          <span className="mac-window__light" data-light="minimize" />
          <span className="mac-window__light" data-light="zoom" />
        </div>
        {title === undefined ? null : <span className="mac-window__title">{title}</span>}
        {toolbar === undefined ? null : <div className="mac-window__toolbar">{toolbar}</div>}
      </div>
      <div className="mac-window__body">{children}</div>
    </div>
  );
}
