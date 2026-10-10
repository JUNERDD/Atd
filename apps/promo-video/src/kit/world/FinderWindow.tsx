import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  Download,
  FileText,
  LayoutGrid,
  Monitor,
} from 'lucide-react';
import type { Lang } from '../../copy.ts';
import { MAC_CHROME, type FinderPlace } from './chrome.ts';
import { FolderIcon } from './FolderIcon.tsx';
import { MacWindow } from './MacWindow.tsx';
import { PdfIcon } from './PdfIcon.tsx';
import type { FinderItem } from './finder.ts';
import type { Rect } from './points.ts';
import './finder.css';

interface FinderWindowProps {
  /** The cut's language, for Finder's own labels. */
  lang: Lang;
  /** The window's frame, in points. */
  box: Rect;
  /**
   * The folder shown: the window's title, selected in the sidebar (added there if not a favorite).
   * A sidebar place is given by its English name and shown in the cut's language.
   */
  title: string;
  items: readonly FinderItem[];
  /** The selected item's index. */
  selected?: number | undefined;
  /** An item being dragged out, drawn faded in its place. */
  lifted?: number | undefined;
  focused?: boolean;
}

const SIDEBAR: readonly { place: FinderPlace; Icon: typeof Clock }[] = [
  { place: 'Recents', Icon: Clock },
  { place: 'Applications', Icon: LayoutGrid },
  { place: 'Desktop', Icon: Monitor },
  { place: 'Documents', Icon: FileText },
  { place: 'Downloads', Icon: Download },
];

function isPlace(title: string): title is FinderPlace {
  return SIDEBAR.some(({ place }) => place === title);
}

/**
 * A Finder window in points: the inset sidebar (Favorites, Locations), a toolbar with back and
 * forward, and the folder's items as icons in a grid. Monochrome, as the film's UI is.
 */
export function FinderWindow({
  lang,
  box,
  title,
  items,
  selected,
  lifted,
  focused = true,
}: FinderWindowProps) {
  const chrome = MAC_CHROME[lang].sidebar;
  const shown = isPlace(title) ? chrome.places[title] : title;
  const sidebar = (
    <div className="finder-sidebar">
      <span className="finder-sidebar__heading">{chrome.favorites}</span>
      {SIDEBAR.map(({ place, Icon }) => (
        <span
          key={place}
          className="finder-sidebar__row"
          data-selected={place === title ? '' : undefined}
        >
          <Icon className="finder-sidebar__icon" size={15} strokeWidth={2} />
          {chrome.places[place]}
        </span>
      ))}
      {isPlace(title) ? null : (
        <span className="finder-sidebar__row" data-selected="">
          <svg className="finder-sidebar__icon" viewBox="0 0 80 64" aria-hidden="true">
            <path d="M4 12a5 5 0 0 1 5-5h18.5a5 5 0 0 1 3.6 1.5l3.8 4h36.1a5 5 0 0 1 5 5V56a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z" />
          </svg>
          {title}
        </span>
      )}
      <span className="finder-sidebar__heading">{chrome.locations}</span>
      <span className="finder-sidebar__row">
        <Cloud className="finder-sidebar__icon" size={15} strokeWidth={2} />
        {chrome.icloud}
      </span>
    </div>
  );
  const toolbar = (
    <>
      <span className="finder-toolbar__button">
        <ChevronLeft size={17} strokeWidth={2.2} />
        <ChevronRight size={17} strokeWidth={2.2} />
      </span>
    </>
  );
  return (
    <MacWindow box={box} title={shown} sidebar={sidebar} toolbar={toolbar} focused={focused}>
      <div className="finder-grid">
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className="finder-grid__cell">
            {item.kind === 'pdf' ? (
              <PdfIcon name={item.name} selected={index === selected} ghost={index === lifted} />
            ) : (
              <FolderIcon name={item.name} selected={index === selected} />
            )}
          </div>
        ))}
      </div>
    </MacWindow>
  );
}
