import {
  Bell,
  ChartColumn,
  Download,
  FileText,
  LayoutDashboard,
  MapPin,
  Route,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { MacWindow } from '../../kit/world/MacWindow.tsx';
import type { Rect } from '../../kit/world/points.ts';
import type { AnywhereContent } from './content.ts';
import { barBox, DASH, DASH_PARTS, DASH_SIDEBAR, PLOT, RIDERS } from './layout.ts';

const NAV_ICONS = [LayoutDashboard, Route, MapPin, Bell, FileText] as const;

/** A part of the dashboard on its box, in the body's points. */
function At({ rect, children }: { rect: Rect; children?: ReactNode }) {
  return (
    <div
      className="aw-dash__at"
      style={{ '--x': rect.x, '--y': rect.y, '--w': rect.width, '--h': rect.height }}
    >
      {children}
    </div>
  );
}

/** A bar of the chart, on its box in the card's points; the peak is lit. */
function Bar({ rect, peak }: { rect: Rect; peak: boolean }) {
  return (
    <i
      className="aw-chart__bar"
      data-peak={peak || undefined}
      style={{ '--x': rect.x, '--y': rect.y, '--w': rect.width, '--h': rect.height }}
    />
  );
}

/**
 * The chart card the capture selects: the riders per hour through the night, in the app's
 * neutral greys. Its box is the card's own; the dashboard places it, and the capture's flight
 * draws it again as the thumbnail.
 */
export function ChartCard({ c }: { c: AnywhereContent }) {
  const { chart } = c.dashboard;
  const slot = PLOT.width / RIDERS.length;
  return (
    <div className="aw-card aw-chart">
      <span className="aw-card__title">{chart.title}</span>
      <span className="aw-card__meta">{chart.subtitle}</span>
      <span className="aw-chart__peak">{chart.peak}</span>
      {[0, 1, 2, 3].map((line) => (
        <i
          key={line}
          className="aw-chart__grid"
          style={{ '--y': PLOT.y + PLOT.bars - (line * (PLOT.bars - 12)) / 3 }}
        />
      ))}
      {RIDERS.map((_, index) => (
        <Bar key={index} rect={barBox(index)} peak={index === 1} />
      ))}
      {chart.hours.map((hour, index) => (
        <span
          key={hour}
          className="aw-chart__hour"
          style={{ '--x': PLOT.x + index * slot, '--w': slot, '--y': PLOT.y + PLOT.bars + 6 }}
        >
          {hour}
        </span>
      ))}
    </div>
  );
}

/**
 * A second app: the night network's ridership dashboard, with a sidebar, a header and its Export
 * button, three figures, the chart card and a list. Every part sits on `DASH_PARTS`, the boxes the
 * capture's element snapping finds.
 */
export function Dashboard({ c, focused = true }: { c: AnywhereContent; focused?: boolean }) {
  const d = c.dashboard;
  const sidebar = (
    <div className="aw-nav">
      <span className="aw-nav__heading">{d.section}</span>
      {d.nav.map((label, index) => {
        const Icon = NAV_ICONS[index] ?? ChartColumn;
        return (
          <span key={label} className="aw-nav__row" data-selected={index === 0 || undefined}>
            <Icon className="aw-nav__icon" />
            {label}
          </span>
        );
      })}
    </div>
  );
  return (
    <MacWindow
      box={DASH}
      title={d.nav[0] ?? ''}
      sidebar={sidebar}
      sidebarWidth={DASH_SIDEBAR}
      focused={focused}
    >
      <div className="aw-dash">
        <At rect={DASH_PARTS.title}>
          <span className="aw-dash__title">{d.title}</span>
        </At>
        <span className="aw-dash__subtitle">{d.subtitle}</span>
        <At rect={DASH_PARTS.export}>
          <span className="aw-button">
            <Download className="aw-button__icon" />
            {d.export}
          </span>
        </At>
        {d.kpis.map((kpi, index) => (
          <At key={kpi.label} rect={DASH_PARTS.kpi(index)}>
            <div className="aw-card aw-kpi">
              <span className="aw-card__meta">{kpi.label}</span>
              <span className="aw-kpi__value">{kpi.value}</span>
              <span className="aw-kpi__delta">{kpi.delta}</span>
            </div>
          </At>
        ))}
        <At rect={DASH_PARTS.chart}>
          <ChartCard c={c} />
        </At>
        <At rect={DASH_PARTS.stations}>
          <div className="aw-card aw-list">
            <span className="aw-card__title">{d.stations.title}</span>
            {d.stations.rows.map(([name, riders]) => (
              <span key={name} className="aw-list__row">
                <span>{name}</span>
                <span className="aw-list__value">{riders}</span>
              </span>
            ))}
          </div>
        </At>
      </div>
    </MacWindow>
  );
}
