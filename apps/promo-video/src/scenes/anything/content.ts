import type { Lang } from '../../copy.ts';
import type { RichBlock } from '../../kit/product/rich.ts';

/** A tool call as the transcript shows it: its step name, what it acts on, and its output. */
interface ToolCall {
  title: string;
  detail: string;
  label: string;
  lines: string[];
  summary?: string;
}

/** What the Anything section shows inside the product's interface, per language. */
interface AnythingContent {
  /** The real task: invoices in Downloads, summarized, with the odd one flagged. */
  work: {
    title: string;
    prompt: string;
    thinking: string;
    todos: string[];
    subagents: { title: string; agent: string }[];
    find: ToolCall;
    read: ToolCall;
    command: ToolCall;
    /** The command the approval card shows, and the allowlist entry its second button names. */
    approval: string;
    entry: string;
    answer: RichBlock[];
    saved: string;
  };
  /** A habit tracker, built, opened and pinned. */
  app: {
    prompt: string;
    name: string;
    summary: string;
    subtitle: string;
    habits: string[];
  };
  /** Three things the agent made when asked. */
  tools: {
    command: string;
    skill: string;
    skillDetail: string;
    automation: string;
    trigger: string;
  };
}

const INVOICES = [
  'Invoice-Acme-0302.pdf',
  'Invoice-Northwind-0306.pdf',
  'Invoice-Globex-0314.pdf',
  'Invoice-Initech-0321.pdf',
  'Invoice-Umbrella-0328.pdf',
];

export const content: Record<Lang, AnythingContent> = {
  en: {
    work: {
      title: 'March invoices',
      prompt: 'Summarize the March invoices in Downloads and flag anything unusual.',
      thinking: 'Finding the invoices first',
      todos: [
        'Find the March invoices',
        'Read each invoice',
        'Total by vendor',
        'Compare with February',
        'Write summary.md',
      ],
      subagents: [
        { title: 'Read the March invoices', agent: 'reader' },
        { title: 'Compare with February', agent: 'analyst' },
      ],
      find: {
        title: 'Find files',
        detail: 'Invoice-*.pdf',
        label: '~/Downloads',
        lines: INVOICES,
        summary: '5 files',
      },
      read: {
        title: 'Read file',
        detail: 'Invoice-Globex-0314.pdf',
        label: 'Invoice-Globex-0314.pdf',
        lines: [
          'GLOBEX CORPORATION · Invoice G-20314',
          'Cloud hosting, March      $4,925.00',
          'Cloud hosting, March      $4,925.00',
          'Total due                 $9,850.00',
        ],
        summary: '1 page',
      },
      command: {
        title: 'Run command',
        detail: 'pdftotext',
        label: '$ pdftotext -layout Invoice-*.pdf - | grep Total',
        lines: [
          'Acme         Total   $4,200.00',
          'Northwind    Total   $1,180.00',
          'Globex       Total   $9,850.00',
          'Initech      Total     $640.00',
          'Umbrella     Total   $1,050.00',
        ],
      },
      approval: 'pdftotext -layout ~/Downloads/Invoice-*.pdf - | grep Total',
      entry: 'pdftotext',
      answer: [
        { p: ['Five invoices, ', { bold: '$16,920' }, ' in total. One needs a look:'] },
        {
          table: {
            head: ['Vendor', 'March', 'February'],
            rows: [
              ['Globex', '$9,850', '$4,925'],
              ['Acme', '$4,200', '$4,200'],
              ['Northwind', '$1,180', '$1,240'],
            ],
          },
        },
        {
          p: ['Globex billed March hosting twice. Saved to ', { code: 'summary.md' }, '.'],
        },
      ],
      saved: 'summary.md',
    },
    app: {
      prompt: 'Make me a habit tracker',
      name: 'Habit Tracker',
      summary: 'A week grid with a check per habit and day.',
      subtitle: 'This week',
      habits: ['Run', 'Read 20 pages', 'No sugar'],
    },
    tools: {
      command: 'Translate to French',
      skill: 'Weekly report',
      skillDetail: 'Summarizes the week from your notes',
      automation: 'Invoices folder',
      trigger: 'When files are added',
    },
  },
  zh: {
    work: {
      title: '三月发票',
      prompt: '总结“下载”里三月的发票，并标出异常。',
      thinking: '先找到发票',
      todos: ['找到三月的发票', '逐张读取发票', '按供应商汇总', '与二月对比', '写好 summary.md'],
      subagents: [
        { title: '读取三月的发票', agent: 'reader' },
        { title: '与二月对比', agent: 'analyst' },
      ],
      find: {
        title: '查找文件',
        detail: 'Invoice-*.pdf',
        label: '~/Downloads',
        lines: INVOICES,
        summary: '5 个文件',
      },
      read: {
        title: '读取文件',
        detail: 'Invoice-Globex-0314.pdf',
        label: 'Invoice-Globex-0314.pdf',
        lines: [
          'GLOBEX CORPORATION · Invoice G-20314',
          'Cloud hosting, March      $4,925.00',
          'Cloud hosting, March      $4,925.00',
          'Total due                 $9,850.00',
        ],
        summary: '1 页',
      },
      command: {
        title: '运行命令',
        detail: 'pdftotext',
        label: '$ pdftotext -layout Invoice-*.pdf - | grep Total',
        lines: [
          'Acme         Total   $4,200.00',
          'Northwind    Total   $1,180.00',
          'Globex       Total   $9,850.00',
          'Initech      Total     $640.00',
          'Umbrella     Total   $1,050.00',
        ],
      },
      approval: 'pdftotext -layout ~/Downloads/Invoice-*.pdf - | grep Total',
      entry: 'pdftotext',
      answer: [
        { p: ['共五张发票，合计 ', { bold: '$16,920' }, '。有一张需要留意：'] },
        {
          table: {
            head: ['供应商', '三月', '二月'],
            rows: [
              ['Globex', '$9,850', '$4,925'],
              ['Acme', '$4,200', '$4,200'],
              ['Northwind', '$1,180', '$1,240'],
            ],
          },
        },
        { p: ['Globex 把三月的主机费重复计了一次。已保存到 ', { code: 'summary.md' }, '。'] },
      ],
      saved: 'summary.md',
    },
    app: {
      prompt: '帮我做一个习惯打卡应用',
      name: '习惯打卡',
      summary: '按周打卡，每个习惯每天一格。',
      subtitle: '本周',
      habits: ['跑步', '读书 20 页', '不吃糖'],
    },
    tools: {
      command: '翻译成法语',
      skill: '周报',
      skillDetail: '根据你的笔记总结一周',
      automation: '发票文件夹',
      trigger: '有新文件加入时',
    },
  },
};
