import type { Lang } from '../../copy.ts';
import type { RichBlock } from '../../kit/product/rich.ts';

/**
 * The article in the reading app, laid out line by line: its lines are set without wrapping, so
 * the drag-selection can find each character under the pointer. It is English in both cuts: the
 * English cut translates it into French, the Chinese cut into Chinese.
 */
interface Article {
  app: string;
  site: string;
  kicker: string;
  title: string;
  dek: readonly string[];
  byline: string;
  /** The paragraphs before the selected one, after it, and the selected one, as set lines. */
  before: readonly (readonly string[])[];
  selected: readonly string[];
  after: readonly (readonly string[])[];
}

interface Dashboard {
  app: string;
  section: string;
  nav: readonly string[];
  title: string;
  subtitle: string;
  export: string;
  kpis: readonly { label: string; value: string; delta: string }[];
  chart: { title: string; subtitle: string; peak: string; hours: readonly string[] };
  stations: { title: string; rows: readonly (readonly [string, string])[] };
}

export interface AnywhereContent {
  article: Article;
  /** The user's commands on the selection toolbar, in the order the app lists them. */
  commands: readonly string[];
  /** What the command run asks for, after its chips; and the task's title in the panel. */
  request: string;
  task: string;
  translation: readonly RichBlock[];
  dashboard: Dashboard;
  /** The capture as the composer names it. */
  screenshot: string;
  finder: { title: string; items: readonly { kind: 'pdf' | 'folder'; name: string }[] };
}

const article: Article = {
  app: 'Reader',
  site: 'City Review',
  kicker: 'TRANSIT',
  title: 'After midnight, the city keeps moving',
  dek: [
    'Three night lines now link the center with the outer',
    'districts until five in the morning.',
  ],
  byline: 'By Lena Ortiz · 4 min read',
  before: [
    [
      'For years, the last train left the center at 12:40, and the night shift',
      'found its own way home. Since Monday, that has changed: the first night',
      'trains in the city’s history are carrying passengers until dawn.',
    ],
  ],
  selected: [
    'Trains now run every twenty minutes between midnight and five,',
    'stopping at twenty-eight stations on three lines. Nurses, bakers',
    'and cleaners who once spent an hour on two buses can be home',
    'in twenty minutes.',
  ],
  after: [
    [
      'The service costs less than expected. The trains share tracks with',
      'daytime freight, and the stations stay open with a small crew rather',
      'than a full staff. Early figures suggest 18,000 riders a night.',
    ],
    [
      '“We built it for the people who keep the city running while it',
      'sleeps,” said the transit director, Amira Haddad.',
    ],
  ],
};

const finder = {
  title: 'Downloads',
  items: [
    { kind: 'pdf', name: 'Night lines timetable.pdf' },
    { kind: 'pdf', name: 'Station survey.pdf' },
    { kind: 'folder', name: 'Maps' },
    { kind: 'pdf', name: 'Fare study.pdf' },
  ],
} as const;

const screenshot = 'Screenshot 2026-10-10 at 9.41.12.png';

/** What the Anywhere section shows inside the product's interface, per language. */
export const content: Record<Lang, AnywhereContent> = {
  en: {
    article,
    commands: ['Translate', 'Summarize'],
    request: 'into French',
    task: 'Translate into French',
    translation: [
      {
        p: [
          'Les trains passent désormais toutes les vingt minutes entre minuit et cinq heures, et desservent vingt-huit stations sur trois lignes. Infirmières, boulangers et agents d’entretien, qui passaient autrefois une heure dans deux bus, peuvent être chez eux en vingt minutes.',
        ],
      },
    ],
    dashboard: {
      app: 'Ridership',
      section: 'Night network',
      nav: ['Overview', 'Lines', 'Stations', 'Alerts', 'Reports'],
      title: 'Tonight',
      subtitle: 'Fri, Oct 10 · Lines N1–N3',
      export: 'Export',
      kpis: [
        { label: 'Riders', value: '18,204', delta: '+12%' },
        { label: 'On time', value: '97.4%', delta: '+0.8 pts' },
        { label: 'Average wait', value: '8 min', delta: '−1 min' },
      ],
      chart: {
        title: 'Riders by hour',
        subtitle: 'All night lines',
        peak: 'Peak 5,240 at 1 AM',
        hours: ['12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM'],
      },
      stations: {
        title: 'Busiest stations',
        rows: [
          ['Central', '4,820'],
          ['Harbor Gate', '2,915'],
          ['North Yard', '2,140'],
        ],
      },
    },
    screenshot,
    finder,
  },
  zh: {
    article,
    commands: ['翻译', '总结'],
    request: '成中文',
    task: '翻译成中文',
    translation: [
      {
        p: [
          '现在，午夜到凌晨五点之间每二十分钟就有一班列车，三条线路共停靠二十八个车站。护士、面包师和保洁员过去要换乘两趟公交、花上一个小时，如今二十分钟就能到家。',
        ],
      },
    ],
    dashboard: {
      app: '客流',
      section: '夜间线网',
      nav: ['总览', '线路', '车站', '告警', '报表'],
      title: '今晚',
      subtitle: '10月10日 周五 · N1–N3 线',
      export: '导出',
      kpis: [
        { label: '客流', value: '18,204', delta: '+12%' },
        { label: '准点率', value: '97.4%', delta: '+0.8 个百分点' },
        { label: '平均候车', value: '8 分钟', delta: '−1 分钟' },
      ],
      chart: {
        title: '分时客流',
        subtitle: '全部夜间线路',
        peak: '峰值 5,240 · 凌晨 1 点',
        hours: ['0 时', '1 时', '2 时', '3 时', '4 时', '5 时'],
      },
      stations: {
        title: '客流最高车站',
        rows: [
          ['中央站', '4,820'],
          ['港门站', '2,915'],
          ['北场站', '2,140'],
        ],
      },
    },
    screenshot,
    finder,
  },
};
