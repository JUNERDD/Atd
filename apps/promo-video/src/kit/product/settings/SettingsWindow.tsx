import type { ReactNode } from 'react';
import {
  AppWindow,
  Blocks,
  Brain,
  ChevronLeft,
  ChevronRight,
  Command,
  Plug,
  Settings,
  Shield,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { htmlLang, type Lang } from '../../../copy.ts';
import { MacWindow } from '../../world/MacWindow.tsx';
import type { Rect } from '../../world/points.ts';
import { IconButton, SearchField } from './controls.tsx';
import { SETTINGS_SIDEBAR_WIDTH } from './layout.ts';
import type { SettingsSectionId } from './settings-strings.ts';
import { strings } from '../strings.ts';
import '../tokens.css';
import './settings-window.css';

/** The sections in navigation order, with their marks (`settings-sections.ts`). */
const SECTIONS: readonly [SettingsSectionId, LucideIcon][] = [
  ['general', Settings],
  ['providers', Plug],
  ['permissions', Shield],
  ['commands', Command],
  ['automations', Zap],
  ['memory', Brain],
  ['apps', AppWindow],
  ['extensions', Blocks],
];

interface SettingsWindowProps {
  lang: Lang;
  /** The window's frame on the display, in points. */
  box: Rect;
  /** The section shown; its row is selected and it heads the breadcrumb. */
  section: SettingsSectionId;
  /** The sub-page's title, which the breadcrumb adds and Back steps out of. */
  subpage?: string | undefined;
  /** False while another window is key: the traffic lights grey and the shadow softens. */
  focused?: boolean;
  /** The page, laid out below the 52 pt header in the content column. */
  children: ReactNode;
}

/**
 * The settings window in its sidebar layout (`settings-window.tsx`, `settings.css`): the macOS 26
 * glass window with the inset sidebar card holding the search field and the sections, and the
 * content column under its 52 pt header, where Back and Forward walk the page history and the
 * breadcrumb names the section and sub-page. No divider or material sits under the header.
 */
export function SettingsWindow({
  lang,
  box,
  section,
  subpage,
  focused = true,
  children,
}: SettingsWindowProps) {
  const chrome = strings[lang].settings;
  const sectionLabel = chrome.sections[section];
  const nav = (
    <div className="rs-nav">
      <SearchField placeholder={chrome.search} />
      <nav className="rs-nav__list">
        {SECTIONS.map(([id, Icon]) => (
          <span key={id} className="rs-nav__row" data-current={id === section || undefined}>
            <Icon className="pk-icon" />
            <span>{chrome.sections[id]}</span>
          </span>
        ))}
      </nav>
    </div>
  );
  const header = (
    <div className="rs-header">
      <IconButton icon={ChevronLeft} disabled={!subpage} />
      <IconButton icon={ChevronRight} disabled />
      <ol className="rs-crumbs">
        <li data-current={subpage ? undefined : ''}>{sectionLabel}</li>
        {subpage && (
          <li data-current="">
            <ChevronRight className="pk-icon rs-crumbs__chevron" />
            {subpage}
          </li>
        )}
      </ol>
    </div>
  );
  return (
    <div className="rs-window" lang={htmlLang(lang)}>
      <MacWindow
        box={box}
        material="glass"
        focused={focused}
        sidebar={nav}
        sidebarWidth={SETTINGS_SIDEBAR_WIDTH}
        toolbar={header}
      >
        <div className="rs-content">{children}</div>
      </MacWindow>
    </div>
  );
}
