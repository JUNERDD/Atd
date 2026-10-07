import type {
  WidgetChartPoint,
  WidgetColor,
  WidgetEntry,
  WidgetFamily,
  WidgetListRow,
  WidgetNode,
  WidgetTextStyle,
  WidgetTimeline,
} from '../../contracts.ts';
import type { BackendContext } from './types.ts';

export interface WidgetRenderOptions {
  family: WidgetFamily;
  /** The instance's configuration; `{}` in v1, where a widget has no parameters. */
  config: Record<string, string | number | boolean>;
}

/**
 * A desktop widget the app offers under the "Atd" widget. WidgetKit renders native views, not
 * HTML, so `render` returns a timeline of view trees built with `w`. The service checks the
 * declaration (id `^[a-z][a-z0-9-]{0,31}$`, 1–3 families, `refreshMinutes` 15–1440) when the
 * backend starts, and every timeline against the widget schema; a rejected one becomes a
 * diagnostic.
 */
export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  families: WidgetFamily[];
  /** How often the service re-renders it, in minutes (15–1440). */
  refreshMinutes: number;
  render(
    ctx: BackendContext,
    options: WidgetRenderOptions,
  ): WidgetTimeline | Promise<WidgetTimeline>;
}

/** Declares a widget; pass the result in `defineBackend({ widgets: [...] })`. */
export function defineWidget(definition: WidgetDefinition): WidgetDefinition {
  return definition;
}

type NodeOf<T extends WidgetNode['type']> = Extract<WidgetNode, { type: T }>;
/** A node's fields besides its `type` (and the children or content the builder takes first). */
type Options<T extends WidgetNode['type'], Taken extends string = never> = Omit<
  NodeOf<T>,
  'type' | Taken
>;

function toIso(date: Date | string): string {
  return typeof date === 'string' ? date : date.toISOString();
}

/**
 * View-tree builders for widget timelines. Colors are semantic tokens (`primary`, `accent`,
 * `success`…); symbols are SF Symbol names; images are PNG/JPEG paths in the app's web root.
 */
export const w = {
  vstack: (children: WidgetNode[], options: Options<'vstack', 'children'> = {}): WidgetNode => ({
    type: 'vstack',
    children,
    ...options,
  }),
  hstack: (children: WidgetNode[], options: Options<'hstack', 'children'> = {}): WidgetNode => ({
    type: 'hstack',
    children,
    ...options,
  }),
  zstack: (children: WidgetNode[], options: Options<'zstack', 'children'> = {}): WidgetNode => ({
    type: 'zstack',
    children,
    ...options,
  }),
  spacer: (minLength?: number): WidgetNode =>
    minLength === undefined ? { type: 'spacer' } : { type: 'spacer', minLength },
  divider: (): WidgetNode => ({ type: 'divider' }),
  text: (text: string, options: Options<'text', 'text'> = {}): WidgetNode => ({
    type: 'text',
    text,
    ...options,
  }),
  /** An SF Symbol, such as `note.text` or `checkmark.circle.fill`. */
  symbol: (name: string, options: Options<'symbol', 'name'> = {}): WidgetNode => ({
    type: 'symbol',
    name,
    ...options,
  }),
  /** A PNG or JPEG (≤ 256 KB) of the app's built web root, such as `assets/chart.png`. */
  image: (src: string, options: Options<'image', 'src'> = {}): WidgetNode => ({
    type: 'image',
    src,
    ...options,
  }),
  gauge: (value: number, options: Options<'gauge', 'value'> = {}): WidgetNode => ({
    type: 'gauge',
    value,
    ...options,
  }),
  /** `value` from 0 to 1. */
  progress: (value: number, options: Options<'progress', 'value'> = {}): WidgetNode => ({
    type: 'progress',
    value,
    ...options,
  }),
  /** A date the system keeps current without re-rendering. */
  date: (
    date: Date | string,
    style: NodeOf<'date'>['style'],
    options: { textStyle?: WidgetTextStyle; color?: WidgetColor } = {},
  ): WidgetNode => ({ type: 'date', date: toIso(date), style, ...options }),
  /** At most 8 rows. */
  list: (rows: WidgetListRow[]): WidgetNode => ({ type: 'list', rows }),
  /** At most 50 points. */
  chart: (
    kind: NodeOf<'chart'>['kind'],
    points: WidgetChartPoint[],
    options: { color?: WidgetColor } = {},
  ): WidgetNode => ({ type: 'chart', kind, points, ...options }),
  /** Opens the app at `route` (a path inside the app, such as `/notes/3`) when tapped. */
  link: (route: string, child: WidgetNode): WidgetNode => ({ type: 'link', route, child }),
  /** One timeline entry, shown from `date` (now by default). */
  entry: (
    view: WidgetNode,
    options: { date?: Date | string; route?: string } = {},
  ): WidgetEntry => ({
    date: toIso(options.date ?? new Date()),
    view,
    ...(options.route === undefined ? {} : { route: options.route }),
  }),
  /** A timeline of 1–24 entries in date order, or of one view shown from now on. */
  timeline: (entries: WidgetEntry[] | WidgetNode): WidgetTimeline => ({
    entries: Array.isArray(entries) ? entries : [w.entry(entries)],
  }),
} as const;
