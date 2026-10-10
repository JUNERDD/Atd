import type { Lang } from '../../copy.ts';
import type { RichBlock } from '../../kit/product/rich.ts';

interface Notice {
  /** The automation's name, which titles its notification. */
  title: string;
  /** The opening of the run's answer, as the notification's body carries it. */
  body: string;
  /** When it was posted; omitted is "now". */
  time?: string;
}

interface AnytimeContent {
  /** The watched folder on the desktop: a file name, the same in both cuts. */
  folder: string;
  /** The two automation results waiting at dawn: the folder's run, then the scheduled brief. */
  notices: readonly [Notice, Notice];
  memory: {
    /** The conversation's title before and after the skip to next week. */
    titles: readonly [string, string];
    /** The earlier exchange, answered in imperial units. */
    ask: string;
    answer: readonly RichBlock[];
    /** The correction the person types... */
    correction: string;
    /** ...what Atd keeps from it... */
    remembered: string;
    /** ...and its reply, already in metric. */
    ack: readonly RichBlock[];
    /** The soft time skip into a new conversation. */
    skip: string;
    /** The later question, and the answer that uses metric on its own (`mark` runs light up). */
    later: string;
    search: { title: string; detail: string };
    answerLater: readonly RichBlock[];
  };
}

/** What the Anytime section shows inside the product's interface, per language. */
export const content = {
  en: {
    folder: 'Invoices',
    notices: [
      {
        title: 'Invoices',
        body: '4 new invoices, $7,340 in total. Summary saved to invoices.md.',
        time: '4:36 AM',
      },
      {
        title: 'Morning brief',
        body: '3 meetings today, the first at 10:00. Light rain after 4 PM.',
      },
    ],
    memory: {
      titles: ['Ridge Trail loop', 'Tomorrow’s ride'],
      ask: 'How far is the Ridge Trail loop?',
      answer: [{ p: ['About ', { bold: '26 miles' }, ', with 2,100 ft of climbing.'] }],
      correction: 'Use metric units, always.',
      remembered: 'prefers metric units',
      ack: [{ p: ['Got it. The loop is ', { bold: '42 km' }, ', with 640 m of climbing.'] }],
      skip: 'Next week · New chat',
      later: 'What’s the weather for tomorrow’s ride?',
      search: { title: 'Search the web', detail: '“weather Saturday”' },
      answerLater: [
        {
          p: [
            'Sunny, ',
            { mark: '14–19 °C' },
            ', with a light west wind at ',
            { mark: '12 km/h' },
            '.',
          ],
        },
      ],
    },
  },
  zh: {
    folder: 'Invoices',
    notices: [
      {
        title: '发票汇总',
        body: '新增 4 张发票，合计 ¥52,180，汇总已存入 invoices.md。',
        time: '04:36',
      },
      { title: '晨间简报', body: '今天有 3 个会议，第一个在 10:00。16 点后有小雨。' },
    ],
    memory: {
      titles: ['山脊步道环线', '明天的骑行'],
      ask: '山脊步道环线有多长？',
      answer: [{ p: ['全程约 ', { bold: '26 英里' }, '，累计爬升 2,100 英尺。'] }],
      correction: '以后一律用公制单位。',
      remembered: '偏好公制单位',
      ack: [{ p: ['好的。环线全程约 ', { bold: '42 公里' }, '，累计爬升 640 米。'] }],
      skip: '一周后 · 新对话',
      later: '明天骑车，天气怎么样？',
      search: { title: '搜索网页', detail: '“周六天气”' },
      answerLater: [
        { p: ['晴，', { mark: '14–19 °C' }, '，西风 ', { mark: '12 公里/小时' }, '。'] },
      ],
    },
  },
} as const satisfies Record<Lang, AnytimeContent>;
