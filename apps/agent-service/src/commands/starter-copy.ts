import type { AppLanguage, CommandParameter } from '@atd/agent-contracts';

/**
 * The words of each starter command in every app language: what the user reads and edits (name,
 * description, instructions, parameter labels) and what the model reads (instructions and the
 * enum values they quote). The rest of a starter is the same in every language (`starters.ts`).
 *
 * A stored starter counts as unmodified only while its copy equals one of these, so changing a
 * shipped text leaves every starter seeded with the old one as it is; keep the English copy as
 * the earlier releases seeded it unless that is intended.
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
] as const;
export type StarterId = (typeof STARTER_IDS)[number];

export interface StarterCopy {
  name: string;
  description: string;
  instructions: string;
  parameters?: CommandParameter[];
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

const EN: Record<StarterId, StarterCopy> = {
  translate: {
    name: 'Translate',
    description: 'Translate the selected text and keep its formatting.',
    instructions:
      'Translate the text below into {{argument.language}}. Preserve its meaning, tone and formatting, including Markdown, line breaks, code, links and names. Return only the translation.\n\n{{input}}',
    parameters: [
      choices('language', 'Target language', [
        'English',
        'Simplified Chinese',
        'Traditional Chinese',
        'Japanese',
        'Korean',
        'French',
        'German',
        'Spanish',
      ]),
    ],
  },
  polish: {
    name: 'Polish writing',
    description: 'Make the selected writing clear and natural.',
    instructions:
      'Improve the clarity, grammar and flow of the text below while keeping its meaning, voice, language and formatting. Return only the revised text.\n\n{{input}}',
  },
  summarize: {
    name: 'Summarize',
    description: 'Condense the selected text to what matters.',
    instructions:
      'Summarize the text below as {{argument.length}}. Keep the facts, decisions and numbers that matter, and write in the same language as the text.\n\n{{input}}',
    parameters: [
      choice(
        'length',
        'Length',
        [
          ['a single sentence', 'One sentence'],
          ['a short paragraph', 'Short paragraph'],
          ['a bulleted list of key points', 'Key points'],
        ],
        'a bulleted list of key points',
      ),
    ],
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
    name: 'Ask about screenshot',
    description: 'Capture part of the screen and ask about it.',
    instructions:
      'Answer the request below about the attached screenshot. When there is no request, describe what the screenshot shows and point out anything that needs attention, such as errors or warnings.\n\n{{input}}',
  },
};

/**
 * Simplified Chinese. An explanation answers in Chinese, the reader's language; a summary or a
 * checklist, which the user may paste back where the text came from, keeps the text's language,
 * as in English.
 */
const ZH_CN: Record<StarterId, StarterCopy> = {
  translate: {
    name: '翻译',
    description: '翻译选中的文本，并保留原有格式。',
    instructions:
      '将下面的文本翻译成{{argument.language}}。保留原文的含义、语气和格式，包括 Markdown、换行、代码、链接和名称。只返回译文。\n\n{{input}}',
    parameters: [
      choices('language', '目标语言', [
        '简体中文',
        '英语',
        '繁体中文',
        '日语',
        '韩语',
        '法语',
        '德语',
        '西班牙语',
      ]),
    ],
  },
  polish: {
    name: '润色文字',
    description: '让选中的文字更清晰、更自然。',
    instructions:
      '在保留原意、文风、语言和格式的前提下，改进下面文本的清晰度、语法和行文流畅度。只返回修改后的文本。\n\n{{input}}',
  },
  summarize: {
    name: '总结',
    description: '把选中的文本浓缩成要点。',
    instructions:
      '将下面的文本总结为{{argument.length}}。保留重要的事实、决定和数字，并使用与原文相同的语言。\n\n{{input}}',
    parameters: [
      choice(
        'length',
        '长度',
        [
          ['一句话', '一句话'],
          ['一个简短的段落', '短段落'],
          ['以项目符号列出的要点', '要点'],
        ],
        '以项目符号列出的要点',
      ),
    ],
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
    name: '就截图提问',
    description: '截取屏幕的一部分，并就它提问。',
    instructions:
      '回答下面关于所附截图的问题。如果没有提问，就描述截图显示的内容，并指出需要注意的地方，例如错误或警告。\n\n{{input}}',
  },
};

export const STARTER_COPY: Record<AppLanguage, Record<StarterId, StarterCopy>> = {
  en: EN,
  'zh-CN': ZH_CN,
};
