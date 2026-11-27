import type { FeaturePage } from './types.ts';

export const screenCapture = {
  slug: 'screen-capture',
  illustration: { case: 'screenshot' },
  updated: '2026-11-23',
  related: ['selection-toolbar', 'computer-use', 'privacy'],
  posts: ['atd-0-12-1', 'atd-0-12-0', 'atd-0-11-0', 'atd-0-10-7'],
  copy: {
    en: {
      name: 'Screen capture',
      summary:
        'Annotated screenshots, scrolling long screenshots and screen recordings you can ask Atd about.',
      headTitle: 'AI screenshot and screen recording tool for Mac — Atd',
      headDescription:
        'Capture, annotate and ask about your Mac screen: scrolling long screenshots, screen recordings with detected steps, and commands on text in a capture.',
      title: 'AI screenshot and screen recording tool for Mac',
      lede: 'Press ⌘ ⇧ 2 to capture part of your screen, mark what matters and ask Atd about it. Stitch a scrolling page into one long screenshot, record your screen with the steps Atd can read, or run a command on the text inside a capture.',
      sections: [
        {
          id: 'annotated-screenshots',
          title: 'Annotated screenshots you can ask about',
          paragraphs: [
            'Press ⌘ ⇧ 2, or start a capture from the Mini Panel or the composer’s + menu, and select an area. On-screen hints show how to select, adjust and confirm, and confirming attaches the screenshot to your message.',
            'A command row under every screenshot offers Ask Atd, Copy Text, Cover Sensitive Info and your screenshot commands. Starter commands explain, translate or summarize a screenshot, or transcribe it as Markdown.',
          ],
          points: [
            'Annotation tools: rectangle, ellipse, arrow, line, pen (with Smart Shapes), highlighter, text with plates and font picker, numbered or lettered steps, spotlight, mosaic (region or brush), custom color wheel and eyedropper.',
            'Pin any screenshot as a borderless floating window across Spaces with zoom, opacity, border and shadow controls.',
            'Save with ⌘ S to a folder you choose, or have Atd ask each time.',
            'Choose in Settings → General → Screenshot whether confirming attaches and copies, attaches only or copies to the clipboard only.',
            'Questions and commands started from captures get their own Captures tab in task history.',
          ],
        },
        {
          id: 'long-screenshots',
          title: 'Long screenshots of scrolling pages',
          paragraphs: [
            'Select a scrollable area and click Long screenshot on the toolbar, or press ⌘ ↓. Scroll through the content yourself, or press Space for Auto-scroll, while Atd stitches the page live beside a preview strip. Press Return to open the Long Screenshot card.',
            'On the card you can trim the top and bottom, check What Atd Will Read page by page, cover sensitive info, annotate in a full-screen preview, ask about the capture, or save, copy and attach it. Settings → General → Screenshot decides whether confirming a long screenshot opens the card, copies it or saves it.',
          ],
        },
        {
          id: 'screen-recording',
          title: 'Screen recordings with steps Atd can read',
          paragraphs: [
            'Switch to Record on the capture bar, choose Screenshot or recording from the composer’s + menu, or press ⌘ ⇧ 3 when that shortcut is available, then record an element, a window or any part of your display. Beside the selection you set the microphone and system audio, a countdown, quality, frame rate, and whether to show the pointer, clicks and keystrokes. Pause, toggle the microphone or stop from the floating capsule, the menu bar timer or ⌃ ⌘ Esc.',
            'When you stop, the Screen Recording card opens over your screen. Trim the timeline, review Steps Atd Will Read (detected clicks, keystrokes, screen changes and narration transcribed on your Mac), then ask a question, save, copy or choose Attach to Conversation. The video file itself is not sent to the model.',
          ],
        },
        {
          id: 'text-in-captures',
          title: 'Run commands on the text in a screenshot',
          paragraphs: [
            'Click Select Text on a screenshot, or in a long screenshot’s full-screen preview, to pick paragraphs or characters while the capture stays open. Commands that read selected text run right on the image, and the result card lets you compare or regenerate versions, restore the original, and copy the screenshot without closing it.',
            'Ask Atd works in Select Text mode too, even on screenshots without recognized text. It can draw boxes, ellipses, arrows, spotlights, numbered steps and mosaic onto the image, or answer as text on the result card.',
          ],
          points: [
            'Replace the selected text: a command such as a translation rewrites the picked paragraphs in place; hold ⌥ to compare with the original.',
            'Insert after the selected text: numbers the paragraphs on the image and lists the notes on a card beside the capture.',
            'Mark the selected text: highlights key passages and numbers steps directly on the screenshot.',
          ],
        },
        {
          id: 'permissions-and-privacy',
          title: 'Permissions and what Atd reads',
          paragraphs: [
            'macOS asks for Screen Recording access when you first capture or record. Atd recognizes the text in a capture on your Mac. A capture reaches a model only when you ask about it, run a command on it or send it in a message, and then it goes to the model provider you configured.',
            'Text covered with the mosaic tool or Cover Sensitive Info can’t be picked and is left out of the recognized text sent with a capture.',
          ],
        },
      ],
      questions: [
        {
          question: 'How do I take a scrolling screenshot on a Mac with Atd?',
          answer:
            'Press ⌘ ⇧ 2, select the scrollable part of the window, then click Long screenshot or press ⌘ ↓. Scroll through the content yourself or press Space to auto-scroll while Atd stitches it. Press Return to open the Long Screenshot card, where you can trim, annotate, ask about, save or copy it.',
        },
        {
          question: 'Does Atd send my screen recording video to the AI model?',
          answer:
            'No. Atd reads a recording as steps: detected clicks, keystrokes, screen changes and narration transcribed on your Mac. You can review them under Steps Atd Will Read and trim the recording before you ask; the video file itself is not sent to the model.',
        },
        {
          question: 'Can I hide sensitive information before asking about a screenshot?',
          answer:
            'Yes. Cover details with the mosaic tool, or use Cover Sensitive Info on the command row. Covered text can’t be picked for a command and is left out of the recognized text sent with the capture.',
        },
        {
          question: 'Can Atd translate or rewrite text inside a screenshot?',
          answer:
            'Yes. Click Select Text, pick the paragraphs, and run a command that reads selected text, such as a translation. Its answer replaces the text on the image while the capture stays open; hold ⌥ to compare with the original, step between versions on the result card, or restore the original.',
        },
      ],
      keywords: [
        'AI screenshot tool for Mac',
        'scrolling screenshot on Mac',
        'long screenshot Mac',
        'Mac screen recorder with AI',
        'annotate screenshots on Mac',
        'translate text in a screenshot',
        'ask AI about a screenshot',
      ],
    },
    zh: {
      name: '截图与录屏',
      summary: '带标注的截图、滚动长截图和录屏，都能直接交给 Atd 提问。',
      headTitle: 'Mac AI 截图、长截图与录屏 — Atd',
      headDescription:
        'Atd 让你在 Mac 上截图标注后直接提问，滚动长截图一键拼接，录屏自动整理步骤，截图里的文字也能运行命令。',
      title: 'Mac AI 截图与录屏工具',
      lede: '按 ⌘ ⇧ 2 截取屏幕的一部分，标出重点，直接问 Atd。滚动页面可以拼成一张滚动长截图，录屏会整理出 Atd 能读懂的操作步骤，截图里的文字也能直接运行命令。',
      sections: [
        {
          id: 'annotated-screenshots',
          title: '截图标注后，直接提问',
          paragraphs: [
            '按 ⌘ ⇧ 2，或从 Mini Panel、输入框的「+」菜单开始截图，框选区域即可。屏幕上的提示会告诉你如何选择、调整和确认；确认后，截图会添加到你的消息里。',
            '每张截图下方都有命令栏：「问 Atd」「复制文字」「遮盖敏感信息」，以及你的截图命令。内置的起始命令可以解释、翻译、总结截图，或把它转写成 Markdown。',
          ],
          points: [
            '标注工具：矩形、椭圆、箭头、直线、画笔（支持智能形状）、荧光笔、带底板与字体选择的文字、数字或字母序号、聚光灯、框选或画笔马赛克，以及自定义色轮与取色器。',
            '点击「贴图」可将截图作为无边框悬浮窗跨空间置顶显示，并支持缩放、透明度、边框与阴影调节。',
            '按 ⌘ S 保存到指定文件夹，也可以设为每次询问。',
            '可在「设置 → 通用 → 截图」中选择确认截图时添加到输入框并复制、仅添加到输入框，或仅复制到剪贴板。',
            '从截图或录屏发起的提问和命令，会单独归入任务历史的「截图/录屏」分类。',
          ],
        },
        {
          id: 'long-screenshots',
          title: '滚动长截图，一张图截完整页',
          paragraphs: [
            '框选一块可滚动的区域，点击工具栏上的「长截图」或按 ⌘ ↓。你可以自己滚动，也可以按 Space 开启「自动滚动」，Atd 会在旁边的预览条里实时拼接。按 ↩ 打开「长截图」结果卡片。',
            '在卡片上可以裁剪首尾、逐页查看「Atd 会读到的内容」、遮盖敏感信息、进入全屏预览标注、就长图提问，或保存、复制、附加到对话。「设置 → 通用 → 截图」可以决定确认长截图后是打开结果卡片、直接复制，还是保存。',
          ],
        },
        {
          id: 'screen-recording',
          title: '录屏，整理出 Atd 能读懂的步骤',
          paragraphs: [
            '在捕获底栏切换到「录屏」、从输入框的「+」菜单选择「截图或录屏」，或在快捷键可用时按 ⌘ ⇧ 3，即可录制屏幕上的元素、窗口或任意区域。选区旁可以设置麦克风和系统声音、倒计时、画质、帧率，以及是否显示指针、点击和按键。录制中可通过悬浮胶囊、菜单栏计时器或 ⌃ ⌘ Esc 暂停、开关麦克风或结束。',
            '结束后，「屏幕录制」结果卡片会在屏幕上方展开。你可以裁剪时间线，查看「Atd 会读到的步骤」（识别出的点击、按键、画面变化，以及在本机转写的旁白），再直接提问、保存、复制或「附加到对话」。视频文件本身不会发送给模型。',
          ],
        },
        {
          id: 'text-in-captures',
          title: '对截图里的文字直接运行命令',
          paragraphs: [
            '在截图上点击「选取文字」（长截图可在全屏预览中进入），就能在截图保持打开时选取段落或字词。读取选中文字的命令会直接在图上运行；在结果卡片中，你可以对比或重新生成版本、还原原文，不退出截图就能复制截图。',
            '「选取文字」模式下同样可以使用「问 Atd」，即使截图里没有识别出文字也可以。它能在图上画出框选、椭圆、箭头、聚光灯、编号步骤和马赛克，也可以在结果卡片上用文字作答。',
          ],
          points: [
            '替换选中的文字：翻译等命令会在原位改写选中的段落，按住 ⌥ 可对照原文。',
            '插入到选中文字之后：在图上为段落标号，说明列在截图旁的卡片里。',
            '标注选中的文字：直接在截图上用荧光笔和编号标出重点与步骤。',
          ],
        },
        {
          id: 'permissions-and-privacy',
          title: '权限，以及 Atd 会读到什么',
          paragraphs: [
            '第一次截图或录屏时，macOS 会请你授予「屏幕录制」权限。截图里的文字在本机识别。只有在你就截图提问、对它运行命令或把它随消息发送时，它才会发给模型，而且只发给你配置的模型提供商。',
            '用马赛克工具或「遮盖敏感信息」盖住的文字无法被选取，也不会随截图的识别文字一起发送。',
          ],
        },
      ],
      questions: [
        {
          question: '在 Mac 上怎样用 Atd 截滚动长截图？',
          answer:
            '按 ⌘ ⇧ 2，框选窗口中可滚动的部分，再点「长截图」或按 ⌘ ↓。你可以自己滚动，也可以按 Space 自动滚动，Atd 会边滚边拼接。按 ↩ 打开「长截图」结果卡片，在那里裁剪、标注、提问、保存或复制。',
        },
        {
          question: 'Atd 会把录屏视频发给 AI 模型吗？',
          answer:
            '不会。Atd 把录屏读成步骤：识别出的点击、按键、画面变化，以及在本机转写的旁白。提问前，你可以在「Atd 会读到的步骤」里查看这些内容并裁剪录屏；视频文件本身不会发送给模型。',
        },
        {
          question: '提问前能遮住截图里的敏感信息吗？',
          answer:
            '可以。用马赛克工具盖住，或在命令栏上使用「遮盖敏感信息」。被遮盖的文字无法被命令选取，也不会随截图的识别文字一起发送。',
        },
        {
          question: 'Atd 能翻译或改写截图里的文字吗？',
          answer:
            '可以。点击「选取文字」，选中段落，运行翻译等读取选中文字的命令。结果会在截图保持打开时原位替换图上的文字；按住 ⌥ 可对照原文，也可以在结果卡片里切换版本或还原原文。',
        },
      ],
      keywords: [
        'Mac AI 截图工具',
        'Mac 滚动长截图',
        'Mac 长截图',
        'Mac 录屏 AI',
        'Mac 截图标注',
        '截图文字翻译',
        '截图提问 AI',
      ],
    },
  },
} as const satisfies FeaturePage;
