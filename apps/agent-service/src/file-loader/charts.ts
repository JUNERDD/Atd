import {
  cachedLevels,
  cachedPoints,
  dimensionLevels,
  MAX_POINTS,
  NO_POINTS,
  oneLine,
  type Points,
} from './chart-cache.js';
import type { Relationship } from './ooxml.js';
import { tableRow } from './slides.js';
import { childElements, descendants, ownText, xmlEntry, type XmlElement } from './xml.js';

/**
 * A chart's data as the chart part caches it: Office saves every series' name, categories and
 * values with the chart, so its numbers read without the workbook it was drawn from.
 */
export interface ChartTable {
  /** The chart's own title, or '' when it shows none. */
  title: string;
  /** Its kind, such as `column chart` or `column and line chart`. */
  kind: string;
  /** Axis titles retain units that would otherwise disappear with the drawing. */
  axes: string[];
  header: string[];
  rows: string[][];
  /** Points past `MAX_POINTS` in the longest series, left out of `rows`. */
  omitted: number;
}

/** DrawingML chart groups (`c:plotArea` children) by local name. */
const KINDS = new Map([
  ['areaChart', 'area'],
  ['area3DChart', 'area'],
  ['barChart', 'bar'],
  ['bar3DChart', 'bar'],
  ['bubbleChart', 'bubble'],
  ['doughnutChart', 'doughnut'],
  ['lineChart', 'line'],
  ['line3DChart', 'line'],
  ['ofPieChart', 'pie'],
  ['pieChart', 'pie'],
  ['pie3DChart', 'pie'],
  ['radarChart', 'radar'],
  ['scatterChart', 'scatter'],
  ['stockChart', 'stock'],
  ['surfaceChart', 'surface'],
  ['surface3DChart', 'surface'],
]);

/** Office 2016 chart layouts (`cx:series` `layoutId`) of chartex parts. */
const EX_KINDS = new Map([
  ['boxWhisker', 'box and whisker'],
  ['clusteredColumn', 'histogram'],
  ['funnel', 'funnel'],
  ['paretoLine', 'Pareto'],
  ['regionMap', 'map'],
  ['sunburst', 'sunburst'],
  ['treemap', 'treemap'],
  ['waterfall', 'waterfall'],
]);

/** A named series of values beside its categories or x values. */
interface Column {
  name: string;
  points: Points;
}

interface Series {
  element: XmlElement;
  xy: boolean;
}

/**
 * The table of a chart part's root element (`c:chartSpace`, or `cx:chartSpace` of an Office 2016
 * chart); undefined when it holds no series with cached data.
 */
export function chartTable(root: XmlElement): ChartTable | undefined {
  if (root.namespaceURI?.endsWith('/chartex')) return chartExTable(root);
  const chart = childElements(root, 'chart')[0];
  const plot = chart && childElements(chart, 'plotArea')[0];
  if (!chart || !plot) return undefined;
  const groups = childElements(plot).filter((group) => KINDS.has(group.localName));
  const series = groups.flatMap((group) =>
    childElements(group, 'ser').map((element) => ({
      element,
      xy: /^(scatter|bubble)Chart$/.test(group.localName),
    })),
  );
  if (!series.length) return undefined;
  const title = titleText(chart);
  const kind = kindName(groups.map(groupKind));
  const axes = childElements(plot)
    .filter((node) => node.localName.endsWith('Ax'))
    .map(titleText)
    .filter(Boolean);
  const date1904 = /^(1|true)$/.test(child(root, 'date1904')?.getAttribute('val') ?? '');
  if (series.some(({ xy }) => xy)) return seriesTable(title, kind, axes, series, date1904);
  const categories =
    series
      .map(({ element }) => cachedLevels(child(element, 'cat'), date1904))
      .find((levels) => levels.some(({ total }) => total)) ?? [];
  const columns = series.map(({ element }, index) => ({
    name: seriesName(element, index),
    points: cachedPoints(child(element, 'val'), date1904),
  }));
  return categoryTable(title, kind, axes, categories, columns);
}

/**
 * The chart as text lines: `Chart: <title> (<kind>)`, its table as pipe rows (a Markdown table
 * with `markdown`), and a note when points were left out.
 */
export function chartLines(table: ChartTable, markdown: boolean): string[] {
  const heading = table.title ? `Chart: ${table.title} (${table.kind})` : `Chart (${table.kind})`;
  const separator = markdown ? [tableRow(table.header.map(() => '---'))] : [];
  const note = table.omitted
    ? [
        `[Chart cut after ${MAX_POINTS} points; ${table.omitted.toLocaleString('en-US')} more are not included]`,
      ]
    : [];
  const caption = table.axes.length ? `${heading} — Axes: ${table.axes.join('; ')}` : heading;
  return [caption, tableRow(table.header), ...separator, ...table.rows.map(tableRow), ...note];
}

/**
 * The lines of the chart part `relationship` points to (a chart or an Office 2016 chart), or a line
 * saying its data could not be read.
 */
export function relatedChartLines(
  files: Record<string, Uint8Array>,
  relationship: Relationship | undefined,
  markdown: boolean,
): string[] {
  const part = relationship && /\/chart(Ex)?$/.test(relationship.type) ? relationship.target : '';
  const root = part ? xmlEntry(files, part) : undefined;
  const table = root ? chartTable(root) : undefined;
  return table ? chartLines(table, markdown) : ['[Chart: its data could not be read]'];
}

/** One row per category: the category, then each series' value. */
function categoryTable(
  title: string,
  kind: string,
  axes: string[],
  categories: readonly Points[],
  columns: readonly Column[],
): ChartTable | undefined {
  const total = Math.max(
    0,
    ...categories.map(({ total }) => total),
    ...columns.map(({ points }) => points.total),
  );
  if (!total) return undefined;
  const shown = Math.min(total, MAX_POINTS);
  const rows = Array.from({ length: shown }, (_, index) => [
    ...(categories.length
      ? categories.map(({ values }) => values[index] ?? '')
      : [String(index + 1)]),
    ...columns.map(({ points }) => points.values[index] ?? ''),
  ]);
  return {
    title,
    kind,
    axes,
    header: [
      ...(categories.length > 1
        ? categories.map((_, index) => `Category ${index + 1}`)
        : ['Category']),
      ...columns.map(({ name }) => name),
    ],
    rows,
    omitted: total - shown,
  };
}

/** Each series keeps its own coordinates, including category/value groups combined with XY. */
function seriesTable(
  title: string,
  kind: string,
  axes: string[],
  series: readonly Series[],
  date1904: boolean,
): ChartTable | undefined {
  const columns = series.flatMap(({ element: ser, xy }, index): Column[] => {
    const name = seriesName(ser, index);
    if (!xy) {
      const categories = cachedLevels(child(ser, 'cat'), date1904);
      return [
        ...categories.map((points, level) => ({
          name: `${name} (category${categories.length > 1 ? ` ${level + 1}` : ''})`,
          points,
        })),
        { name, points: cachedPoints(child(ser, 'val'), date1904) },
      ];
    }
    const sizes = child(ser, 'bubbleSize');
    return [
      { name: `${name} (x)`, points: cachedPoints(child(ser, 'xVal'), date1904) },
      { name: `${name} (y)`, points: cachedPoints(child(ser, 'yVal'), date1904) },
      ...(sizes ? [{ name: `${name} (size)`, points: cachedPoints(sizes, date1904) }] : []),
    ];
  });
  const total = Math.max(...columns.map(({ points }) => points.total));
  if (!total) return undefined;
  const shown = Math.min(total, MAX_POINTS);
  return {
    title,
    kind,
    axes,
    header: columns.map(({ name }) => name),
    rows: Array.from({ length: shown }, (_, index) =>
      columns.map(({ points }) => points.values[index] ?? ''),
    ),
    omitted: total - shown,
  };
}

/**
 * An Office 2016 chart (waterfall, histogram, treemap and the like): its series name their data
 * (`cx:dataId`) in `cx:chartData`, whose dimensions hold categories and values.
 */
function chartExTable(root: XmlElement): ChartTable | undefined {
  const data = new Map(
    descendants(root, 'data').map((item) => [item.getAttribute('id') ?? '', item] as const),
  );
  const chart = childElements(root, 'chart')[0];
  const series = chart ? descendants(chart, 'series') : [];
  const read = series.flatMap((item, index) => {
    const dataId = child(item, 'dataId')?.getAttribute('val') ?? '';
    const dims = data.get(dataId);
    if (!dims) return [];
    const values = dimension(dims, 'val');
    return [
      {
        kind: EX_KINDS.get(item.getAttribute('layoutId') ?? '') ?? 'chart',
        name: exSeriesName(item, index),
        categories: dimensionLevels(dims, 'cat'),
        values: values.total ? values : dimension(dims, 'size'),
      },
    ];
  });
  if (!read.length || !chart) return undefined;
  const categories =
    read.find(({ categories }) => categories.some(({ total }) => total))?.categories ?? [];
  return categoryTable(
    titleText(chart),
    kindName(read.map(({ kind }) => kind)),
    descendants(chart, 'axis').map(titleText).filter(Boolean),
    categories,
    read.map(({ name, values }) => ({ name, points: values })),
  );
}

/** The innermost values of a chartex data dimension. */
function dimension(data: XmlElement, type: string): Points {
  return dimensionLevels(data, type).at(-1) ?? NO_POINTS;
}

function seriesName(ser: XmlElement, index: number): string {
  const tx = child(ser, 'tx');
  const name = tx ? (cachedPoints(tx).values[0] ?? ownText(child(tx, 'v') ?? tx)) : '';
  return oneLine(name) || `Series ${index + 1}`;
}

function exSeriesName(series: XmlElement, index: number): string {
  const tx = child(series, 'tx');
  return oneLine(tx ? descendants(tx, 'v').map(ownText).join(' ') : '') || `Series ${index + 1}`;
}

/** A chart's title: its rich text, or the cell text it caches; '' without a title. */
function titleText(chart: XmlElement): string {
  const tx = child(child(chart, 'title'), 'tx');
  if (!tx) return '';
  const rich = child(tx, 'rich');
  const text = rich
    ? childElements(rich, 'p')
        .map((paragraph) => descendants(paragraph, 't').map(ownText).join(''))
        .join(' ')
    : (cachedPoints(tx).values[0] ?? descendants(tx, 'v').map(ownText).join(' '));
  return oneLine(text);
}

/** A chart group's kind; a bar chart whose bars stand upright is a column chart. */
function groupKind(group: XmlElement): string {
  const kind = KINDS.get(group.localName) ?? 'chart';
  return kind === 'bar' && child(group, 'barDir')?.getAttribute('val') === 'col' ? 'column' : kind;
}

/** `column chart`, `column and line chart`; a histogram keeps its own name. */
function kindName(kinds: readonly string[]): string {
  const distinct = [...new Set(kinds)];
  const named = distinct.join(' and ');
  return distinct.length === 1 && /^(histogram|chart)$/.test(named) ? named : `${named} chart`;
}

function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return element ? childElements(element, name)[0] : undefined;
}
