import type { Lang } from '../../copy.ts';
import type { RichBlock } from './rich.ts';

/**
 * Stand-in content for the product kit's review sheet only. Scenes bring their own from their
 * `content.ts`; nothing here reaches the film.
 */
interface SheetContent {
  prompt: string;
  typing: string;
  quote: string;
  thinking: string;
  search: string;
  command: string;
  searchLines: string[];
  commandLines: string[];
  reply: RichBlock[];
  later: RichBlock[];
  todos: string[];
  subagents: { title: string; agent: string }[];
  editDetail: string;
  appName: string;
  appSummary: string;
  thisWeek: string;
  habits: string[];
  created: {
    command: string;
    skill: string;
    skillDetail: string;
    automation: string;
    trigger: string;
  };
  memory: string;
  commands: string[];
  notice: { title: string; body: string };
}

export const sheetContent: Record<Lang, SheetContent> = {
  en: {
    prompt: 'Summarize the March invoices and flag anything unusual.',
    typing: 'Make me a habit tracker',
    quote: 'The new pricing applies from April 1',
    thinking: 'Finding the invoices first',
    search: 'invoice',
    command: 'pdftotext -layout',
    searchLines: [
      'Invoices/2026-03-acme.pdf',
      'Invoices/2026-03-northwind.pdf',
      'Invoices/2026-03-globex.pdf',
      'Invoices/2026-03-initech.pdf',
      'Invoices/2026-03-umbrella.pdf',
    ],
    commandLines: [
      '$ pdftotext -layout Invoices/*.pdf -',
      'ACME Corp        Total  $4,200.00',
      'Northwind        Total  $1,180.00',
      'Globex           Total  $9,850.00',
      'Initech          Total  $  640.00',
    ],
    reply: [
      {
        p: ['Five invoices came in for March, ', { bold: '$16,920' }, ' in total. One stands out:'],
      },
      {
        table: {
          head: ['Vendor', 'Amount', 'Note'],
          rows: [
            ['Globex', '$9,850', 'Twice February'],
            ['ACME', '$4,200', 'Usual'],
          ],
        },
      },
      { p: ['I saved the details to ', { code: 'summary.md' }, '.'] },
    ],
    later: [
      {
        p: ['The ride is ', { mark: '42 km' }, ' and it will be ', { mark: '18 °C' }, ' at noon.'],
      },
    ],
    todos: [
      'Find the March invoices',
      'Read each PDF',
      'Total by vendor',
      'Flag anything unusual',
      'Write the summary',
    ],
    subagents: [
      { title: 'Read the March invoices', agent: 'reader' },
      { title: 'Compare with February', agent: 'analyst' },
    ],
    editDetail: '~/Documents/Finance/vendors.csv\n+ Globex, flagged 2026-03',
    appName: 'Habit Tracker',
    appSummary: 'A week grid with a check per habit and day.',
    thisWeek: 'This week',
    habits: ['Run', 'Read 20 pages', 'No sugar'],
    created: {
      command: 'Translate to French',
      skill: 'Weekly report',
      skillDetail: 'Summarizes the week from your notes',
      automation: 'Invoices folder',
      trigger: 'When files are added to Invoices',
    },
    memory: 'prefers metric units',
    commands: ['Translate', 'Summarize'],
    notice: { title: 'Invoices', body: 'Two new invoices filed. Globex is billed twice.' },
  },
  zh: {
    prompt: '总结三月的发票，标出异常的地方。',
    typing: '帮我做一个习惯打卡应用',
    quote: '新价格自 4 月 1 日起生效',
    thinking: '先找到发票',
    search: 'invoice',
    command: 'pdftotext -layout',
    searchLines: [
      '发票/2026-03-acme.pdf',
      '发票/2026-03-northwind.pdf',
      '发票/2026-03-globex.pdf',
      '发票/2026-03-initech.pdf',
      '发票/2026-03-umbrella.pdf',
    ],
    commandLines: [
      '$ pdftotext -layout 发票/*.pdf -',
      'ACME Corp        合计  ¥4,200.00',
      'Northwind        合计  ¥1,180.00',
      'Globex           合计  ¥9,850.00',
      'Initech          合计  ¥  640.00',
    ],
    reply: [
      { p: ['三月共收到五张发票，合计 ', { bold: '¥16,920' }, '。其中一张需要注意：'] },
      {
        table: {
          head: ['供应商', '金额', '说明'],
          rows: [
            ['Globex', '¥9,850', '是二月的两倍'],
            ['ACME', '¥4,200', '正常'],
          ],
        },
      },
      { p: ['明细已保存到 ', { code: 'summary.md' }, '。'] },
    ],
    later: [{ p: ['这段骑行 ', { mark: '42 公里' }, '，中午气温 ', { mark: '18 °C' }, '。'] }],
    todos: ['找到三月的发票', '逐个读取 PDF', '按供应商汇总', '标出异常', '写好总结'],
    subagents: [
      { title: '读取三月的发票', agent: 'reader' },
      { title: '与二月对比', agent: 'analyst' },
    ],
    editDetail: '~/Documents/Finance/vendors.csv\n+ Globex，已标记 2026-03',
    appName: '习惯打卡',
    appSummary: '按周的打卡表，每个习惯每天一格。',
    thisWeek: '本周',
    habits: ['跑步', '读书 20 页', '不吃糖'],
    created: {
      command: '翻译成法语',
      skill: '周报',
      skillDetail: '根据你的笔记总结一周',
      automation: '发票文件夹',
      trigger: '发票 中新增文件时',
    },
    memory: '偏好公制单位',
    commands: ['翻译', '总结'],
    notice: { title: '发票', body: '新归档两张发票，Globex 重复开票。' },
  },
};

/** Every string the sheet shows in `lang`, for its font subsets. */
export function sheetText(lang: Lang): string {
  const parts: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') parts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(sheetContent[lang]);
  return parts.join('');
}
