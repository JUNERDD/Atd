import type { AppLanguage, CommandParameter } from '@atd/agent-contracts';

/**
 * The words of each starter command in every app language: what the user reads and edits (name,
 * description, instructions, parameter labels, adjustment suggestions) and what the model reads
 * (instructions, the enum values they quote and the suggestions a review sends). The rest of a
 * starter is the same in every language (`starters.ts`).
 *
 * A stored starter counts as unmodified only while its copy equals one of these or one it shipped
 * with before (`RETIRED_COPY`), so changing a shipped text leaves every starter seeded with the
 * old one as it is unless the old text moves there; keep the English copy as the earlier releases
 * seeded it unless that is intended. Adjustment suggestions do not count (`starters.ts`): the
 * starters that rework the selection (translating, polishing) offer a few for the review card,
 * and an unmodified one takes the current ones.
 *
 * The screenshot starters mirror the selection ones on the screenshot toolbar: explaining,
 * translating and summarizing what a screenshot shows, and transcribing it as Markdown, which goes
 * further than the toolbar's own Copy text. `ask-screenshot` keeps the id of the question it
 * replaced; the toolbar's Ask Atd now asks free questions.
 */

export const STARTER_IDS = [
  'translate',
  'polish',
  'summarize',
  'explain',
  'action-items',
  'review-code',
  'summarize-files',
  'ask-screenshot',
  'translate-screenshot',
  'summarize-screenshot',
  'screenshot-markdown',
] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface StarterCopy {
  name: string;
  description: string;
  instructions: string;
  parameters?: CommandParameter[];
  adjustments?: string[];
}

/** A required enum parameter whose option values are the phrases the instructions read. */
function choice(
  key: string,
  label: string,
  options: ReadonlyArray<[value: string, label: string]>,
  fallback: string,
): CommandParameter {
  return {
    key,
    label,
    description: '',
    type: 'enum',
    required: true,
    default: fallback,
    options: options.map(([value, option]) => ({ value, label: option })),
  };
}

/** Each option is its own label; the first one is the default. */
function choices(key: string, label: string, values: readonly string[]): CommandParameter {
  return choice(
    key,
    label,
    values.map((value) => [value, value]),
    values[0] ?? '',
  );
}

const EN_LANGUAGE = choices('language', 'Target language', [
  'English',
  'Simplified Chinese',
  'Traditional Chinese',
  'Japanese',
  'Korean',
  'French',
  'German',
  'Spanish',
]);

const EN_LENGTH = choice(
  'length',
  'Length',
  [
    ['a single sentence', 'One sentence'],
    ['a short paragraph', 'Short paragraph'],
    ['a bulleted list of key points', 'Key points'],
  ],
  'a bulleted list of key points',
);

const EN: Record<StarterId, StarterCopy> = {
  translate: {
    name: 'Translate',
    description: 'Translate the selected text and keep its formatting.',
    instructions:
      'Translate the text below into {{argument.language}}. Preserve its meaning, tone and formatting, including Markdown, line breaks, code, links and names. Return only the translation.\n\n{{input}}',
    parameters: [EN_LANGUAGE],
    adjustments: ['More natural', 'More formal', 'More casual', 'Keep terms untranslated'],
  },
  polish: {
    name: 'Polish writing',
    description: 'Make the selected writing clear and natural.',
    instructions:
      'Improve the clarity, grammar and flow of the text below while keeping its meaning, voice, language and formatting. Return only the revised text.\n\n{{input}}',
    adjustments: ['Shorter', 'More formal', 'Friendlier', 'Fewer changes'],
  },
  summarize: {
    name: 'Summarize',
    description: 'Condense the selected text to what matters.',
    instructions:
      'Summarize the text below as {{argument.length}}. Keep the facts, decisions and numbers that matter, and write in the same language as the text.\n\n{{input}}',
    parameters: [EN_LENGTH],
  },
  explain: {
    name: 'Explain',
    description: 'Explain the selected text or code in plain language.',
    instructions:
      'Explain the text below in plain language: what it means, the key terms, and any context needed to understand it. If it is code, explain what it does step by step and point out anything surprising. Answer in the same language as the text.\n\n{{input}}',
  },
  'action-items': {
    name: 'Extract action items',
    description: 'Turn notes into a list of next steps.',
    instructions:
      'Extract the action items from the text below as a checklist grouped by {{argument.group_by}}. Keep named owners and dates, and mark missing ones as unspecified. Write in the same language as the text.\n\n{{input}}',
    parameters: [
      choice(
        'group_by',
        'Group by',
        [
          ['owner', 'Owner'],
          ['due date', 'Due date'],
          ['priority', 'Priority'],
        ],
        'owner',
      ),
    ],
  },
  'review-code': {
    name: 'Review code',
    description: 'Find bugs and risks in the selected code.',
    instructions:
      'Review the code below. List concrete problems, most severe first: bugs, unhandled edge cases, security risks and misleading names. Give each a one-line reason and a short fix. If you find none, say so plainly. Do not rewrite the whole code.\n\n{{input}}',
  },
  'summarize-files': {
    name: 'Summarize files',
    description: 'Find the key points in attached files.',
    instructions:
      'Summarize the attached files: the key points of each and any next steps they imply, citing file names.\n\n{{input}}\n\n{{files}}',
  },
  'ask-screenshot': {
    name: 'Explain screenshot',
    description: 'Explain an error, chart, code or screen you capture.',
    instructions:
      'Explain the attached screenshot in plain language. If it shows an error or a warning, say what it means, its likely cause and how to fix it; if it shows a chart or a table, give the key takeaways; if it shows code, explain what it does; otherwise describe what matters in it. When there is a request below, answer that instead. Answer in the same language as the text in the screenshot.\n\n{{input}}',
  },
  'translate-screenshot': {
    name: 'Translate screenshot',
    description: 'Translate the text in a part of the screen.',
    instructions:
      'Translate the text in the attached screenshot into {{argument.language}}. Keep its structure, such as headings, lists, table rows and line breaks, and leave names, code, links and numbers as they are. Return only the translation, following any note below.\n\n{{input}}',
    parameters: [EN_LANGUAGE],
  },
  'summarize-screenshot': {
    name: 'Summarize screenshot',
    description: 'Condense an article, chat or long page you capture.',
    instructions:
      'Summarize the text in the attached screenshot as {{argument.length}}. Keep the facts, decisions and numbers that matter, leave out the interface around the content, and write in the same language as the text, following any note below.\n\n{{input}}',
    parameters: [EN_LENGTH],
  },
  'screenshot-markdown': {
    name: 'Screenshot to Markdown',
    description: 'Copy the text you capture as Markdown, tables and code included.',
    instructions:
      'Transcribe the content of the attached screenshot as Markdown, in reading order: keep headings, lists, links and emphasis, write tables as Markdown tables and code as fenced code blocks with its language. Copy the text exactly as shown, without translating, correcting or adding to it, and leave out window chrome and interface controls that are not part of the content. Follow any note below.\n\n{{input}}',
  },
};

/**
 * Simplified Chinese. An explanation answers in Chinese, the reader's language; a summary or a
 * checklist, which the user may paste back where the text came from, keeps the text's language,
 * as in English.
 */
const ZH_LANGUAGE = choices('language', '目标语言', [
  '简体中文',
  '英语',
  '繁体中文',
  '日语',
  '韩语',
  '法语',
  '德语',
  '西班牙语',
]);

const ZH_LENGTH = choice(
  'length',
  '长度',
  [
    ['一句话', '一句话'],
    ['一个简短的段落', '短段落'],
    ['以项目符号列出的要点', '要点'],
  ],
  '以项目符号列出的要点',
);

const ZH_CN: Record<StarterId, StarterCopy> = {
  translate: {
    name: '翻译',
    description: '翻译选中的文本，并保留原有格式。',
    instructions:
      '将下面的文本翻译成{{argument.language}}。保留原文的含义、语气和格式，包括 Markdown、换行、代码、链接和名称。只返回译文。\n\n{{input}}',
    parameters: [ZH_LANGUAGE],
    adjustments: ['更自然', '更正式', '更口语化', '术语保留原文'],
  },
  polish: {
    name: '润色文字',
    description: '让选中的文字更清晰、更自然。',
    instructions:
      '在保留原意、文风、语言和格式的前提下，改进下面文本的清晰度、语法和行文流畅度。只返回修改后的文本。\n\n{{input}}',
    adjustments: ['更简洁', '更正式', '更亲切', '改动更少'],
  },
  summarize: {
    name: '总结',
    description: '把选中的文本浓缩成要点。',
    instructions:
      '将下面的文本总结为{{argument.length}}。保留重要的事实、决定和数字，并使用与原文相同的语言。\n\n{{input}}',
    parameters: [ZH_LENGTH],
  },
  explain: {
    name: '解释',
    description: '用浅显的语言解释选中的文本或代码。',
    instructions:
      '用浅显的语言解释下面的文本：它的含义、其中的关键术语，以及理解它所需的背景。如果是代码，请逐步说明它做了什么，并指出任何出人意料的地方。用简体中文回答。\n\n{{input}}',
  },
  'action-items': {
    name: '提取待办事项',
    description: '把笔记整理成下一步行动清单。',
    instructions:
      '从下面的文本中提取待办事项，整理成按{{argument.group_by}}分组的清单。保留写明的负责人和日期，没有写明的标注为未指定。使用与原文相同的语言。\n\n{{input}}',
    parameters: [choices('group_by', '分组方式', ['负责人', '截止日期', '优先级'])],
  },
  'review-code': {
    name: '审查代码',
    description: '找出选中代码中的缺陷和风险。',
    instructions:
      '审查下面的代码。按严重程度从高到低列出具体问题：缺陷、未处理的边界情况、安全风险和有误导性的命名。每个问题用一句话说明原因，并给出简短的修复建议。如果没有发现问题，请直接说明。不要重写整段代码。\n\n{{input}}',
  },
  'summarize-files': {
    name: '总结文件',
    description: '找出附件中的要点。',
    instructions:
      '总结所附的文件：每个文件的要点，以及它们涉及的后续步骤，并注明文件名。\n\n{{input}}\n\n{{files}}',
  },
  'ask-screenshot': {
    name: '解释截图',
    description: '解释截取的报错、图表、代码或界面。',
    instructions:
      '用浅显的语言解释所附截图。如果是报错或警告，说明它的含义、可能的原因和解决办法；如果是图表或表格，给出关键结论；如果是代码，说明它做了什么；其他情况则说明其中的要点。如果下面有具体的问题，就回答这个问题。用简体中文回答。\n\n{{input}}',
  },
  'translate-screenshot': {
    name: '翻译截图',
    description: '翻译屏幕上一块区域里的文字。',
    instructions:
      '将所附截图中的文字翻译成{{argument.language}}。保留标题、列表、表格行和换行等结构，名称、代码、链接和数字保持原样。只返回译文，并遵循下面的补充说明（如有）。\n\n{{input}}',
    parameters: [ZH_LANGUAGE],
  },
  'summarize-screenshot': {
    name: '总结截图',
    description: '浓缩截取的文章、聊天记录或长页面。',
    instructions:
      '将所附截图中的文字总结为{{argument.length}}。保留重要的事实、决定和数字，略去内容之外的界面元素，使用与原文相同的语言，并遵循下面的补充说明（如有）。\n\n{{input}}',
    parameters: [ZH_LENGTH],
  },
  'screenshot-markdown': {
    name: '截图转 Markdown',
    description: '把截取的内容拷贝为 Markdown，表格和代码也保留。',
    instructions:
      '按阅读顺序把所附截图的内容转写为 Markdown：保留标题、列表、链接和强调，表格写成 Markdown 表格，代码写成标明语言的围栏代码块。照原样转写文字，不要翻译、纠正或补充，并略去不属于内容的窗口边框和界面控件。遵循下面的补充说明（如有）。\n\n{{input}}',
  },
};

export const STARTER_COPY: Record<AppLanguage, Record<StarterId, StarterCopy>> = {
  en: EN,
  'zh-CN': ZH_CN,
};

/**
 * Words a starter shipped with before its current copy, in every language: a stored starter that
 * still reads as one of them counts as unmodified, so it takes the current shape and words. The
 * screenshot question became Explain screenshot once Ask Atd took free questions on the toolbar.
 */
export const RETIRED_COPY: Partial<Record<StarterId, readonly StarterCopy[]>> = {
  'ask-screenshot': [
    {
      name: 'Ask about screenshot',
      description: 'Capture part of the screen and ask about it.',
      instructions:
        'Answer the request below about the attached screenshot. When there is no request, describe what the screenshot shows and point out anything that needs attention, such as errors or warnings.\n\n{{input}}',
    },
    {
      name: '就截图提问',
      description: '截取屏幕的一部分，并就它提问。',
      instructions:
        '回答下面关于所附截图的问题。如果没有提问，就描述截图显示的内容，并指出需要注意的地方，例如错误或警告。\n\n{{input}}',
    },
  ],
};
