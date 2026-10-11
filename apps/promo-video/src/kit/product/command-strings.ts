import type { Shape } from './strings.ts';

/**
 * The command island's and the selection toolbar's options copy, as the shell ships it
 * (`commandOptions.*`, `commandProgress.*` in `apps/macos/App/Localizable.xcstrings`), and the
 * write-back notes the page hands the island (`commandOutput.*` in the renderer's `tasks.json`).
 * The catalog's `%@` is `{{name}}` here, `{{keys}}` is where a hint's keycaps go, and `{{app}}` /
 * `{{command}}` are the page's own placeholders. Part of `strings[lang].command`.
 */
const en = {
  holdHint: 'Hold for options',
  run: 'Run',
  escapeHint: 'Press {{keys}} to cancel',
  working: 'Running {{name}}',
  writing: 'Writing…',
  done: 'Written',
  copied: 'Copied',
  /** The split button chevron's tooltip and label. */
  menu: '{{name}} options',
  /** The values chip on the working capsule. */
  change: 'Change options',
  /** An input option's hand-off to the panel. */
  edit: 'Fill in Atd',
  filter: 'Filter options',
  noMatch: 'No matching options',
  keys: {
    move: 'Move',
    pick: 'Pick',
    close: 'Close',
    back: 'Back',
    change: 'Change',
    open: 'Open',
    run: 'Run',
  },
  /** The "When done" choice: the label, each destination in the settings' order, the saved one. */
  output: {
    label: 'When done',
    panel: 'Show in the conversation',
    replaceSelection: 'Replace the selected text',
    insertAfterSelection: 'Insert after the selected text',
    insertAtCursor: 'Insert at the cursor',
    copy: 'Copy to the clipboard',
    saved: '{{name}} (default)',
  },
  /** The answer card, and the notice capsule's buttons. */
  answer: {
    title: 'Answer from {{name}}',
    copy: 'Copy',
    close: 'Close',
    openInAtd: 'Open in Atd',
    open: 'Open',
    dismiss: 'Dismiss',
    cancel: 'Cancel',
  },
  /** Why an answer was not written (`commandOutput.unwritten.*`), shown under the card's title. */
  unwritten: {
    notTrusted: "Accessibility is off, so the answer wasn't written into {{app}}.",
    targetGone: "The field in {{app}} is no longer available, so the answer wasn't written.",
    targetChanged: "The field in {{app}} changed, so the answer wasn't written.",
    noSelection: "Nothing was selected in {{app}}, so the answer wasn't written.",
    secureInput: "{{app}} has secure input on, so the answer wasn't written.",
    failed: "The answer couldn't be written into {{app}}.",
  },
  /** A run that ends without writing (`commandOutput.progress.*`), on the notice capsule. */
  progress: {
    failed: "{{command}} didn't finish.",
    stopped: '{{command}} was stopped.',
    startFailed: "{{command}} couldn't start.",
    empty: '{{command}} had no answer to write.',
  },
};

export type CommandStrings = Shape<typeof en>;

const zh: CommandStrings = {
  holdHint: '按住可选选项',
  run: '运行',
  escapeHint: '按 {{keys}} 取消',
  working: '正在运行“{{name}}”',
  writing: '正在写入…',
  done: '已写入',
  copied: '已复制',
  menu: '{{name}}的选项',
  change: '更改选项',
  edit: '在 Atd 中填写',
  filter: '筛选选项',
  noMatch: '没有匹配的选项',
  keys: {
    move: '移动',
    pick: '快选',
    close: '收起',
    back: '返回',
    change: '换值',
    open: '展开',
    run: '运行',
  },
  output: {
    label: '回答完成后',
    panel: '显示在对话中',
    replaceSelection: '替换选中的文字',
    insertAfterSelection: '插入到选中文字之后',
    insertAtCursor: '插入到光标处',
    copy: '拷贝到剪贴板',
    saved: '{{name}}（默认）',
  },
  answer: {
    title: '“{{name}}”的回答',
    copy: '复制',
    close: '关闭',
    openInAtd: '在 Atd 中打开',
    open: '打开',
    dismiss: '关闭',
    cancel: '取消',
  },
  unwritten: {
    notTrusted: '辅助功能权限未开启，回答未写入 {{app}}。',
    targetGone: '已无法访问 {{app}} 中的输入框，回答未写入。',
    targetChanged: '{{app}} 中的输入框已变化，回答未写入。',
    noSelection: '{{app}} 中没有选中文本，回答未写入。',
    secureInput: '{{app}} 正处于安全输入状态，回答未写入。',
    failed: '无法写入 {{app}}。',
  },
  progress: {
    failed: '{{command}} 未能完成。',
    stopped: '{{command}} 已停止。',
    startFailed: '{{command}} 无法开始运行。',
    empty: '{{command}} 没有可写入的回答。',
  },
};

export const commandStrings = { en, zh };
