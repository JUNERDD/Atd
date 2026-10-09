import { useEffect, useRef } from 'react';

interface Tab {
  id: string;
  name: string;
}

interface CaseTabsProps {
  /** Names the list for assistive technology. */
  label: string;
  tabs: readonly Tab[];
  active: number;
  onSelect: (index: number) => void;
}

const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * The showcase's scenes by name, above the screen, over one line that fills from left to right as
 * the scenes scroll by (`--case-fill`, set by use-case-scroll.ts), so it moves 1:1 with the scroll;
 * each name goes straight to its scene. The row stays on one line; where the names do not all fit
 * it scrolls sideways (cases.css), and the current name is brought to its middle as they change.
 */
export function CaseTabs({ label, tabs, active, onSelect }: CaseTabsProps) {
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const row = rail.current;
    const current = row?.querySelectorAll<HTMLElement>('.cases__view')[active];
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;
    row.scrollTo({
      left: current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2,
      behavior: matchMedia(REDUCED).matches ? 'auto' : 'smooth',
    });
  }, [active]);

  return (
    <div ref={rail} className="cases__tabs">
      <ol className="cases__views" aria-label={label}>
        {tabs.map((tab, index) => (
          <li key={tab.id}>
            <button
              type="button"
              className="cases__view"
              aria-current={index === active ? 'true' : undefined}
              aria-controls="case-screen"
              data-case-fill=""
              onClick={() => onSelect(index)}
            >
              <span className="cases__view-name">{tab.name}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
