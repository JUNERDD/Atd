import type { FaqGroup } from './types.ts';

/** Getting around Atd and what its main capabilities do. */
export const using = {
  id: 'using-atd',
  title: { en: 'Using Atd', zh: '使用 Atd' },
  entries: [
    {
      id: 'shortcuts',
      question: {
        en: 'How do I open Atd, and can I change its shortcuts?',
        zh: '如何唤出 Atd？快捷键可以改吗？',
      },
      answer: {
        en: [
          'Press ⌘ ⇧ Space to show or hide the main panel, or open it from the menu bar icon. Other default shortcuts: ⌘ ⇧ 2 takes a screenshot, ⌘ ⇧ 3 records the screen, ⌘ ⇧ M switches model aliases, ⌘ N starts a new conversation and ⌘ , opens Settings.',
          'You can change these shortcuts in Settings → General.',
        ],
        zh: [
          '按 ⌘ ⇧ Space 显示或隐藏主面板，也可以从菜单栏图标打开。其他默认快捷键：⌘ ⇧ 2 截图，⌘ ⇧ 3 录屏，⌘ ⇧ M 切换模型别名，⌘ N 新建对话，⌘ , 打开设置。',
          '这些快捷键都可以在“设置 → 通用”中修改。',
        ],
      },
    },
    {
      id: 'selected-text',
      question: { en: 'How do I use Atd on selected text?', zh: '如何对选中的文字使用 Atd？' },
      answer: {
        en: [
          'Select text in an app and the selection toolbar appears, where you can ask about the text or run a saved command on it. The answer can replace the selection, go in after it or at the cursor, be copied, or open in a conversation.',
          'Commands can also have their own shortcuts: tap one to reuse the options you picked last, or hold it to choose them. The toolbar needs Accessibility permission, and Settings → General lets you choose how it comes up, exclude apps, or start with a small icon.',
        ],
        zh: [
          '在应用中选中文字，选区工具栏就会出现：可以就这段文字提问，或对它运行已保存的命令。结果可以替换选中内容、插入到其后或光标处、复制，或在对话中打开。',
          '命令还可以设置专属快捷键：轻按会沿用上次选择的选项，按住则可以重新选择。选区工具栏需要“辅助功能”权限；在“设置 → 通用”中，可以设置它的呼出方式、排除特定应用，或让它先只显示一个小图标。',
        ],
      },
      see: 'selection-toolbar',
    },
    {
      id: 'screenshots-and-recording',
      question: {
        en: 'Can Atd take screenshots and record my screen?',
        zh: 'Atd 能截图和录屏吗？',
      },
      answer: {
        en: [
          'Yes. Press ⌘ ⇧ 2 to capture an area, mark it up with shapes, arrows, Smart Shapes, step numbers, notes, spotlight or a mosaic, pin it as a floating window across Spaces, or ask about it and run commands on its text. For a page longer than the screen, Long screenshot stitches the scrolling area as you scroll or as Auto-scroll moves through it.',
          'Switch to Record on the capture bar to record an element, a window or part of your display, with optional microphone and system audio. Atd reads the detected clicks, keystrokes, screen changes and on-device narration rather than sending the video file to the model. Both need the Screen Recording permission.',
        ],
        zh: [
          '可以。按 ⌘ ⇧ 2 框选区域截图，用形状、箭头、智能形状、编号、文字、聚光灯或马赛克做好标注，一键贴图置顶跨桌面空间显示，或直接提问、对图中的文字运行命令。页面超过一屏时，滚动长截图会在你手动滚动或开启“自动滚动”时把整页拼接起来。',
          '在捕获底栏切换到“录屏”，即可录制某个元素、窗口或屏幕的任意区域，可选录入麦克风和系统声音。Atd 读取的是识别出的点击、按键、画面变化和本机转写的旁白，不会把视频文件发给模型。截图和录屏都需要“屏幕录制”权限。',
        ],
      },
      see: 'screen-capture',
    },
    {
      id: 'computer-use',
      question: {
        en: 'Can Atd control apps and websites on my Mac?',
        zh: 'Atd 能操作我 Mac 上的应用和网站吗？',
      },
      answer: {
        en: [
          'Yes, with your permission. Ask in a conversation and Atd requests access to the websites and Mac apps the task needs. Mac app control is included; for websites, install the optional browser engine from Engines in Settings → Computer use, then add a browser environment, a separate Chrome profile you sign in to.',
          'Atd works in the background where the app or site supports it. Stop all in Settings → Computer use stops computer actions across tasks and automations, and disconnecting an app or website revokes its saved access.',
        ],
        zh: [
          '可以，但需要你的授权。在对话中提出需求，Atd 会请求任务所需网站和 Mac 应用的访问权限。Mac 应用操作已内置；网站则需要先在“设置 → 电脑操作”的“引擎”中安装可选的浏览器引擎，再“添加浏览器环境”，即一个供你登录网站的独立 Chrome 配置。',
          '在应用或网站支持的情况下，Atd 会在后台操作。“设置 → 电脑操作”中的“全部停止”可以停止所有任务和自动化中的电脑操作；断开某个应用或网站会撤销它已保存的访问权限。',
        ],
      },
      see: 'computer-use',
    },
    {
      id: 'mcp-and-skills',
      question: {
        en: 'Does Atd support MCP servers and skills?',
        zh: 'Atd 支持 MCP 服务器和技能吗？',
      },
      answer: {
        en: [
          'Yes. Atd can use MCP servers over stdio, Streamable HTTP or SSE, along with skills and subagents. Add them in Settings → Extensions, one by one or through supported plugin bundles, or ask Atd in a conversation to set one up; it shows what it will save and asks you to confirm.',
          'A newly added MCP server may need your approval in Settings → Extensions before it runs. Type / in the composer to pick an enabled skill, and save prompts you reuse as commands with parameters and their own shortcuts.',
        ],
        zh: [
          '支持。Atd 可以使用通过 stdio、Streamable HTTP 或 SSE 连接的 MCP 服务器，以及技能和子代理。你可以在“设置 → 扩展”中逐个添加，或通过受支持的插件包添加；也可以直接在对话中让 Atd 帮你配置，它会先列出要保存的内容并请你确认。',
          '新添加的 MCP 服务器可能需要你在“设置 → 扩展”中批准后才能运行。在输入框中输入 /，即可用斜杠命令选用已启用的技能；常用的提示词还可以保存为带参数和专属快捷键的命令。',
        ],
      },
      see: 'mcp-and-skills',
    },
    {
      id: 'automations',
      question: {
        en: 'Do Atd automations run when Atd is closed?',
        zh: 'Atd 关闭后，自动化还会运行吗？',
      },
      answer: {
        en: [
          'No. Automations run only while Atd is running. If a scheduled run is missed because your Mac was asleep or Atd was closed, each automation either runs the latest missed occurrence once when Atd is back, or skips it.',
          'An automation can start on a schedule, when files are added or changed in a folder, when your Mac has been idle, or after another automation finishes, and it runs a prompt or a saved command. Runs are unattended, so actions that would need approval are declined instead of waiting. Check status and run history, or pause automations, in Settings → Automations.',
        ],
        zh: [
          '不会。自动化只在 Atd 运行时执行。如果因为 Mac 睡眠或 Atd 关闭而错过了计划时间，每个自动化可以在 Atd 再次运行后补跑最近错过的一次，或者直接跳过。',
          '自动化可以按计划触发，也可以在文件夹中有文件新增或变更时、Mac 闲置时，或另一个自动化结束后触发，执行一段提示词或一条已保存的命令。运行时无人值守，原本需要审批的操作会被直接拒绝，而不是等待。可以在“设置 → 自动化”中查看状态和运行记录，或暂停自动化。',
        ],
      },
      see: 'automations',
    },
    {
      id: 'build-apps',
      question: { en: 'Can Atd build apps for me?', zh: 'Atd 能帮我做应用吗？' },
      answer: {
        en: [
          'Yes, small personal ones. Describe a tool in a conversation and Atd builds it as an app you can open again from My apps. An app can have its own window, a backend that keeps data and calls the models you’ve connected, and desktop widgets.',
          'To change an app, return to the task where it was made and ask for the change.',
        ],
        zh: [
          '可以，适合做小巧的个人应用。在对话中描述你想要的工具，Atd 会把它做成应用，之后随时可以从“我的应用”打开。应用可以有独立窗口、能保存数据并调用你所接入模型的后端，以及桌面小组件。',
          '想修改应用时，回到创建它的那个任务中提出修改即可。',
        ],
      },
      see: 'apps',
    },
  ],
} as const satisfies FaqGroup;
