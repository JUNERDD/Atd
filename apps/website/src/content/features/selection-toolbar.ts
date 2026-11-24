import type { FeaturePage } from './types.ts';

export const selectionToolbar = {
  slug: 'selection-toolbar',
  illustration: { case: 'selection-toolbar' },
  updated: '2026-11-24',
  related: ['screen-capture', 'models', 'automations'],
  posts: ['atd-0-11-0', 'atd-0-10-6'],
  copy: {
    en: {
      name: 'Selection toolbar',
      summary:
        'Select text in another app to ask Atd or run a saved command, then choose where the answer goes.',
      headTitle: 'AI text selection toolbar for Mac apps — Atd',
      headDescription:
        'Select text in a Mac app to ask Atd or run a saved command, then replace the text, insert after it, copy the answer or open it in a conversation.',
      title: 'AI text selection toolbar for Mac',
      lede: 'Select text in another app and a toolbar appears beside it. Ask Atd about it or run a saved command, such as fixing grammar or translating, then decide whether the answer replaces your text, goes after it, is copied or opens in a conversation.',
      sections: [
        {
          id: 'what-it-does',
          title: 'Ask or run a command on the text you select',
          paragraphs: [
            'The selection toolbar works on text you select in other Mac apps. Ask Atd a question about the selection, or run a saved command on it. Commands that read the selected text appear on the toolbar automatically, and you can change a command’s options right beside its button.',
            'Tap a command to run it with the options you picked last, or hold it to choose them first. The same commands also run from their own global shortcuts; with nothing selected, a selection command asks for the text in a small card and puts its answer at the cursor.',
          ],
        },
        {
          id: 'answer-destinations',
          title: 'Choose where the answer goes',
          paragraphs: [
            'Every command has a result setting that decides what happens when the answer is ready, and the answer always stays in the conversation as well:',
          ],
          points: [
            'Replace the selected text: for rewrites, translations and grammar fixes.',
            'Insert after the selected text: keeps the original and adds the answer after it, for replies and continuations.',
            'Insert at the cursor: types the answer where the cursor was.',
            'Copy to the clipboard.',
            'Show in a card: a floating card over the app that renders formatted Markdown as it streams (toggleable under Settings → General), ready to copy, insert or open in Atd.',
            'Show in the conversation: the answer stays in the panel.',
          ],
        },
        {
          id: 'review-before-applying',
          title: 'Review an answer before it lands',
          paragraphs: [
            'Turn on Review before applying for a command or one of its shortcuts, and its answer waits on a review card beside your original instead of writing straight into the app. Regenerate it, type a note, pick adjustment suggestions or change option values, step between versions, then insert or replace.',
            'If the app can’t take text where you are, the answer shows in a card for you to copy. Writing back and cards only happen when a command runs from another app through the toolbar or its shortcut; a run started in the panel keeps its answer in the conversation.',
          ],
        },
        {
          id: 'saved-commands',
          title: 'Saved commands with options and shortcuts',
          paragraphs: [
            'Create commands in Settings → Commands, or describe one in a conversation and Atd saves it once you confirm. A command holds its instructions, where its text comes from (the selection, typed text, the clipboard or a screenshot) and where its answer goes.',
            'Parameters turn a choice you switch between runs into an option, such as the target language or tone. Choices and switches can be picked right on the toolbar, and a command starts from the values you used last. Each command can have up to eight global shortcuts, each fixing its own values or answer destination: one key to translate into English and another into German, for example.',
          ],
          points: [
            'Parameter types: text, number, choice and switch.',
            'Up to eight adjustment suggestions, shown as chips on the review card.',
            'Shortcuts can be a key combination or a double-tap of ⌘, ⌥, ⌃ or ⇧.',
            'Offer a command on the toolbar in other apps, the toolbar in conversations, text in a screenshot, or a turn’s actions.',
          ],
        },
        {
          id: 'when-it-appears',
          title: 'Control when the toolbar appears',
          paragraphs: [
            'The toolbar needs Accessibility access (Device Control and Data Access on newer macOS), which macOS asks for when you start using it. In Settings → General → Selection toolbar you choose how it comes up: on any selection, only while you hold keys, or switched on and off by pressing keys twice.',
            'It can start as a small icon by the pointer that expands on click or hover, appear next to the pointer, above or below the selection, and stay out of apps you exclude. An optional integration also brings it up for spreadsheet selections in WPS.',
          ],
        },
      ],
      questions: [
        {
          question: 'Does the selection toolbar work in every Mac app?',
          answer:
            'It works on text you select in other apps that share their selection with macOS. Some editors don’t expose enough to recognize every selection or to take text back; then the answer shows in a card for you to copy. You can also keep the toolbar out of specific apps under Excluded apps in Settings → General → Selection toolbar.',
        },
        {
          question: 'Can I check an answer before it replaces my text?',
          answer:
            'Yes. Turn on Review before applying for the command or for one of its shortcuts. The answer then waits on a review card beside your original, where you can regenerate it, add a note, pick adjustment suggestions, compare versions, and finally insert it after the selection or replace it.',
        },
        {
          question: 'What happens if nothing is selected when I press a command’s shortcut?',
          answer:
            'A command that works on selected text asks for the text in a small card and runs on what you type. If its answer is set to replace the selection or go after it, the answer goes in at the cursor instead.',
        },
        {
          question: 'Can one command have different shortcuts for different options?',
          answer:
            'Yes. A command can have up to eight global shortcuts. Each one can fix parameter values, where the answer goes or the reasoning level, and anything it leaves unset follows the command. Commands with different instructions or inputs are separate commands.',
        },
      ],
      keywords: [
        'AI selection toolbar for Mac',
        'AI writing assistant in any Mac app',
        'rewrite selected text with AI',
        'translate selected text on Mac',
        'fix grammar in any app',
        'custom AI commands with shortcuts',
      ],
    },
    zh: {
      name: '选区工具栏',
      summary: '在其他应用里选中文字，就能问 Atd 或运行已保存的命令，结果放哪里由你决定。',
      headTitle: 'Mac 划词 AI 工具栏 — Atd',
      headDescription:
        '在 Mac 应用里选中文字即可问 Atd 或运行命令，结果可替换原文、插在其后、复制，或在对话中打开。',
      title: 'Mac 划词 AI 工具栏',
      lede: '在其他应用里选中文字，选区工具栏就出现在旁边。直接问 Atd，或运行润色、翻译等已保存的命令，再决定结果是替换原文、插在原文之后、复制，还是在对话中打开。',
      sections: [
        {
          id: 'what-it-does',
          title: '对选中的文字提问或运行命令',
          paragraphs: [
            '选区工具栏作用于你在其他 Mac 应用里选中的文字。可以就选中内容问 Atd，也可以对它运行已保存的命令。读取选中文字的命令会自动出现在工具栏上，按钮旁就能随手调整命令的选项。',
            '轻点命令，会沿用你上次选的选项；按住命令，可以先选好再运行。同样的命令也能用各自的全局快捷键运行；没有选中文字时，选区命令会弹出小卡片让你输入文字，结果写到光标处。',
          ],
        },
        {
          id: 'answer-destinations',
          title: '结果放在哪里，由你决定',
          paragraphs: ['每个命令都有结果设置，决定回答完成后怎么处理；回答也始终会保留在对话中：'],
          points: [
            '替换选中的文字：适合改写、翻译和语法修正。',
            '插入到选中文字之后：保留原文，把结果接在后面，适合回复和续写。',
            '插入到光标处：在光标所在处输入结果。',
            '拷贝到剪贴板。',
            '显示在卡片中：悬浮在当前应用上方，流式渲染格式化 Markdown（可在「设置 → 通用」关闭），可拷贝、插入或在 Atd 中打开。',
            '显示在对话中：结果只留在面板里。',
          ],
        },
        {
          id: 'review-before-applying',
          title: '先确认，再写入',
          paragraphs: [
            '为命令或它的某个快捷键开启「应用前确认」后，结果会先显示在原文旁的审阅卡片上，而不是直接写进应用。你可以重新生成、输入补充说明、选择调整建议或修改选项，在不同版本间切换，满意后再插入或替换。',
            '如果当前应用无法在该处写入文字，结果会显示在卡片中供你拷贝。只有通过工具栏或快捷键从其他应用运行命令时，才会写回或显示卡片；在面板里运行的命令，结果保留在对话中。',
          ],
        },
        {
          id: 'saved-commands',
          title: '带选项和快捷键的已保存命令',
          paragraphs: [
            '你可以在「设置 → 命令」中创建命令，也可以在对话里描述需求，确认后由 Atd 帮你保存。命令包含它的指令、文字来源（选中的文字、手动输入、剪贴板或截图）以及结果去向。',
            '参数能把每次运行都可能切换的选择变成选项，比如目标语言或语气。选项和开关类参数可以直接在工具栏上选，命令会从你上次用过的值开始。每个命令最多可设 8 个全局快捷键，各自固定不同的参数值或结果去向，比如一个键译成英文，另一个键译成德文。',
          ],
          points: [
            '参数类型：文本、数字、选项和开关。',
            '最多 8 项调整建议，在审阅卡片上显示为快捷选项。',
            '快捷键可以是组合键，也可以是连按两次 ⌘、⌥、⌃ 或 ⇧。',
            '可选择命令的显示位置：其他应用中的选择文字工具栏、对话中的选择文字工具栏、截图里的文字，或每轮对话的操作。',
          ],
        },
        {
          id: 'when-it-appears',
          title: '决定工具栏何时出现',
          paragraphs: [
            '选区工具栏需要“辅助功能”权限（新版 macOS 中为“设备控制和数据访问”），开始使用时 macOS 会请你授权。在「设置 → 通用 → 选择文字工具栏」中可以选择呼出方式：选中即显示、按住按键时显示，或连按两次按键开关。',
            '它可以先以小图标出现在鼠标旁，点击或悬停后展开；完整工具栏可以出现在鼠标旁、选区上方或下方；你也可以把不想打扰的应用加入「排除的 App」。另有可选的 WPS 表格选区适配，在 WPS 中选取表格内容时也能唤出工具栏。',
          ],
        },
      ],
      questions: [
        {
          question: '选区工具栏在所有 Mac 应用里都能用吗？',
          answer:
            '它作用于那些会把选区提供给 macOS 的应用中的文字。有些编辑器提供的信息不足，无法识别每一种选区或写回文字，这时结果会显示在卡片中供你拷贝。你也可以在「设置 → 通用 → 选择文字工具栏」的「排除的 App」中，让工具栏在指定应用里不再出现。',
        },
        {
          question: '结果替换原文之前，我能先确认吗？',
          answer:
            '可以。为命令或它的某个快捷键开启「应用前确认」。结果会先显示在原文旁的审阅卡片上，你可以重新生成、补充说明、选择调整建议、对比版本，最后再插入到选中文字之后或替换原文。',
        },
        {
          question: '按下命令快捷键时没有选中文字，会怎样？',
          answer:
            '读取选中文字的命令会弹出一张小卡片，让你输入文字，再对输入内容运行。如果它的结果设置为替换选区或插在选区之后，结果会改为写到光标处。',
        },
        {
          question: '同一个命令能用不同的快捷键对应不同选项吗？',
          answer:
            '可以。一个命令最多可设 8 个全局快捷键，每个快捷键都可以固定参数值、结果去向或推理强度，没设置的部分跟随命令本身。指令或输入来源不同的，则应保存为不同的命令。',
        },
      ],
      keywords: [
        'Mac 划词 AI 工具栏',
        'Mac 划词翻译',
        '选中文字 AI 改写',
        '任意应用 AI 写作助手',
        'Mac 语法修正',
        '自定义 AI 命令快捷键',
      ],
    },
  },
} as const satisfies FeaturePage;
