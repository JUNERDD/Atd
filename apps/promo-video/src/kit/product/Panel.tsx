import type { ReactNode } from 'react';
import { History, Settings } from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { DropsGlyph } from './DropsGlyph.tsx';
import { strings } from './strings.ts';
import './tokens.css';
import './panel.css';

export type PanelControl = 'brand' | 'tasks' | 'settings';

export interface PanelProps {
  lang: Lang;
  /** The header title: the conversation's name, or "New task" (the default) before one exists. */
  title?: string;
  /**
   * Points the transcript is scrolled back from its end. At 0 the newest content rests just above
   * the composer, as the app follows a live reply; a short transcript sinks to the composer.
   */
  scroll?: number;
  /** The transcript, top to bottom. Without it the panel shows its welcome. */
  children?: ReactNode;
  /** The footer: a `Composer`, which carries the progress pill above its field. */
  composer?: ReactNode;
  /**
   * The one popover above the composer (`TodoList`, `ApprovalCard`, `SubagentChips`): it floats
   * over the transcript, its bottom 8 pt above the composer's top edge.
   */
  popover?: ReactNode;
  /** A header control held down: its glass wash deepens. */
  pressed?: PanelControl;
  /** The window's traffic lights, which macOS paints over the header's leading 88 pt. */
  trafficLights?: boolean;
}

/**
 * The task panel (500 × 680 pt, `.glass[data-glass='panel']`): the 52 pt header on the unified
 * title bar (traffic lights, the Drops mark button that starts a new chat, the title, Tasks and
 * Settings), the transcript, and the composer floating over its faded end. Static apart from its
 * inputs: animate what goes in it.
 */
export function Panel({
  lang,
  title,
  scroll = 0,
  children,
  composer,
  popover,
  pressed,
  trafficLights = true,
}: PanelProps) {
  const t = strings[lang].panel;
  return (
    <section className="glass pk-panel" data-glass="panel" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      <header className="pk-panel__header">
        {trafficLights && (
          <span className="pk-lights" aria-hidden="true">
            <i data-light="close" />
            <i data-light="minimize" />
            <i data-light="zoom" />
          </span>
        )}
        <span
          className="pk-header-button"
          data-brand=""
          data-pressed={pressed === 'brand' || undefined}
        >
          <DropsGlyph className="pk-panel__mark" />
        </span>
        <h1 className="pk-panel__title">{title ?? t.newTask}</h1>
        <nav className="pk-panel__controls">
          <span className="pk-header-button" data-pressed={pressed === 'tasks' || undefined}>
            <History className="pk-icon" />
          </span>
          <span className="pk-header-button" data-pressed={pressed === 'settings' || undefined}>
            <Settings className="pk-icon" />
          </span>
        </nav>
      </header>
      <div className="pk-panel__body">
        <div className="pk-panel__transcript">
          {children === undefined ? (
            <div className="pk-panel__welcome">
              <h2>{t.welcomeTitle}</h2>
              <p>{t.welcomeSubtitle}</p>
            </div>
          ) : (
            <div className="pk-panel__messages" style={{ '--scroll': `${scroll}px` }}>
              {children}
            </div>
          )}
        </div>
        <footer className="pk-panel__footer">
          {popover && <div className="pk-panel__popover">{popover}</div>}
          {composer}
        </footer>
      </div>
    </section>
  );
}
