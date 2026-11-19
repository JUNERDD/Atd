import type { FeaturePage } from './types.ts';

export const computerUse = {
  slug: 'computer-use',
  illustration: { case: 'computer-use' },
  updated: '2026-11-18',
  related: ['automations', 'privacy', 'models'],
  posts: [],
  copy: {
    en: {
      name: 'Computer use',
      summary:
        'Atd works in Mac apps and websites for a task, only where you approve, and stops when you say so.',
      headTitle: 'AI computer use agent for Mac apps and websites — Atd',
      headDescription:
        'Atd is a free, open-source AI agent for macOS that works in your Mac apps and websites, only with access you approve, and stops on request.',
      title: 'AI computer use agent for Mac',
      lede: 'Ask Atd to get something done in a Mac app or on a website, and it works there in the background with a pointer of its own. It acts only in the apps and sites you approve, checks the results of its actions, and stops when you say so.',
      sections: [
        {
          id: 'what-it-does',
          title: 'What computer use does on your Mac',
          paragraphs: [
            'Computer use lets an Atd task operate the interfaces you would otherwise click through yourself: Mac apps and websites you sign in to. You describe the goal in a conversation. Atd reads the app’s controls and the screen, clicks, types, chooses menu items and scrolls, then reports what it did and anything it could not confirm.',
            'It takes the direct route when there is one: if a file tool, a terminal command or an API can do the job, the task prefers it over the interface.',
          ],
          points: [
            'Mac app control is included with Atd; there is nothing extra to install.',
            'Website control uses an optional browser engine and a separate Chrome profile.',
            'Atd works in the background and never moves your pointer.',
            'Clicks, submissions and other actions with effects are checked against an expected result before the next step.',
            'Stop all ends computer actions in every task and automation at once.',
          ],
        },
        {
          id: 'how-it-works',
          title: 'How Atd operates apps and websites, step by step',
          paragraphs: [
            'You start from an ordinary conversation in the panel. A task requests access to an app or website when it reaches the step that needs it, so a known app needs no setup beforehand.',
          ],
          points: [
            'Ask: describe the task, such as filling in a web form from a document or updating an entry in a Mac app.',
            'Approve: Atd requests each app or website it needs, and the request follows the task’s approval mode.',
            'Work: Atd reads the window’s controls, recognized text and a screenshot, then clicks, types, picks menu items or scrolls.',
            'Check: after an action with effects, Atd confirms the expected result appeared before it continues.',
            'Review: the conversation shows each step, and Atd tells you what it could not verify or needs you to do.',
          ],
        },
        {
          id: 'access-and-control',
          title: 'Access you approve, and how to take it back',
          paragraphs: [
            'Atd acts only in apps and websites approved for the task. Under Manual approval you approve each new app or site, and that access lasts for the run. Under Auto approval, a model checks each request against what you asked and still asks you when it looks risky; access approved under Auto approval or Always allow is saved for later tasks.',
            'Settings → Computer use lists saved access, lets you add an app or website yourself, and shows whether the macOS permissions are on. Disconnect revokes a target’s saved access; for a website, the sign-in data in its browser environment is kept. Stop all ends everything Atd is doing on websites and apps, in tasks and automations alike.',
          ],
          points: [
            'A browser environment opens only the sites you allowed for it.',
            'An action whose result Atd can’t confirm is never repeated automatically: further actions in that app or site wait until you look and choose Mark as checked.',
          ],
        },
        {
          id: 'websites-and-apps',
          title: 'Websites in a separate Chrome profile, Mac apps in the background',
          paragraphs: [
            'For websites, install the optional browser engine from Engines in Settings → Computer use, then choose Add browser environment. Atd opens a separate Chrome profile for it, never your everyday one, so Google Chrome must be installed. Sign in there and list the sites it may use, one per line; Atd won’t open pages outside them.',
            'For Mac apps, choose Add application, or let a task request the app. Atd works in the app’s windows in the background where the app supports it. In a task you start, a step the background can’t do may briefly bring the app forward, send that step’s clicks and keys straight to it without moving your pointer, then switch back to the app you were using. Websites always stay in the background.',
            'By default the task’s model reads the screen. Under Screen understanding you can pick a separate image-capable model for that, and Show live pointer marks where Atd is working in a target you can see.',
          ],
        },
        {
          id: 'limits',
          title: 'What stays with you',
          paragraphs: [
            'Atd can’t hover, drag between windows or apps, act on a locked screen or in secure input such as password fields, and it never opens context menus. When a task needs one of these steps, a sign-in or a permission, Atd asks you to do it and checks the state again afterwards.',
            'Automations can’t request new access. Computer actions in an automation need separate authorization in Settings → Automations, and only in apps or websites checked for automation use.',
          ],
        },
      ],
      questions: [
        {
          question: 'Does Atd take over my mouse and keyboard?',
          answer:
            'No. Atd works in the background where the app or website supports it, and it never moves your pointer. In a task you start, a step that only works in the foreground can briefly bring a Mac app forward, send that step’s clicks and keys straight to it, and then return you to the app you were using. Websites and automations always stay in the background.',
        },
        {
          question: 'Can Atd use websites I’m signed in to?',
          answer:
            'Not through your everyday browser profile. Each browser environment is a separate Chrome profile that Atd opens for it: you sign in there once, choose the sites it may use, and the sign-in data stays in that profile on your Mac. Disconnecting the environment revokes Atd’s access but keeps the sign-in data.',
        },
        {
          question: 'Which macOS permissions does computer use need?',
          answer:
            'App control, which macOS lists under Accessibility (Device Control and Data Access on newer versions), lets Atd read and operate app controls, and Screen Recording lets it take pictures of a target as evidence. Settings → Computer use shows whether each is on and opens System Settings for you; Prepare screen access there lets macOS ask about screen capture before a task instead of during one.',
        },
        {
          question: 'How do I stop Atd while it’s working?',
          answer:
            'Stop the run from its conversation, or choose Stop all in Settings → Computer use to end every computer action across tasks and automations. To take access away for good, disconnect the app or website in the same place.',
        },
        {
          question: 'Can Atd watch my screen while I do something?',
          answer:
            'Yes, in a task you start, when you ask it to follow your screen. You choose up to four windows or displays in the macOS picker. Sharing is read-only, needs an image-capable model, and ends when the task finishes or you stop it from macOS.',
        },
      ],
      keywords: [
        'AI computer use agent for Mac',
        'AI agent that controls Mac apps',
        'AI browser agent',
        'automate Mac apps with AI',
        'macOS desktop AI agent',
        'open-source computer use',
      ],
    },
    zh: {
      name: '电脑操作',
      summary: 'Atd 在你批准的 Mac 应用和网站里替你完成任务，随时可以叫停。',
      headTitle: 'Mac 电脑操作 AI 智能体 — Atd',
      headDescription:
        '免费开源的 Mac AI 智能体 Atd，经你授权在后台操作 Mac 应用和网站，核实每步结果，随时可全部停止。',
      title: 'Mac 电脑操作 AI 智能体',
      lede: '在对话里告诉 Atd 要在哪个 Mac 应用或网站里做什么，它会在后台用自己的指针替你操作。它只在你批准的应用和网站里工作，会核实操作结果，你说停就停。',
      sections: [
        {
          id: 'what-it-does',
          title: '电脑操作能在 Mac 上做什么',
          paragraphs: [
            '电脑操作让 Atd 的任务替你使用那些原本要亲手点来点去的界面：Mac 应用，以及你需要登录的网站。你在对话里说明目标，Atd 读取应用的控件和屏幕画面，完成点击、输入、选择菜单和滚动，最后告诉你做了什么、哪些结果还没能确认。',
            '能走捷径时它会优先走捷径：如果文件工具、终端命令或 API 能直接完成，任务会优先用它们，而不是绕道界面。',
          ],
          points: [
            '操作 Mac 应用的能力随 Atd 内置，无需另外安装。',
            '操作网站需要安装可选的浏览器引擎，并使用独立的 Chrome 配置文件。',
            'Atd 在后台工作，不会移动你的指针。',
            '点击、提交等会产生改动的操作，都会先核对预期结果，再进行下一步。',
            '「全部停止」可一次结束所有任务和自动化中的电脑操作。',
          ],
        },
        {
          id: 'how-it-works',
          title: 'Atd 如何一步步操作应用和网站',
          paragraphs: [
            '一切从主面板里的普通对话开始。任务走到需要某个应用或网站的那一步时才会请求访问权限，所以常用应用无需提前设置。',
          ],
          points: [
            '提出需求：说明要做的事，比如按文档填写网页表单，或在某个 Mac 应用里更新一条记录。',
            '批准访问：Atd 逐个请求所需的应用或网站，请求遵循任务当前的审批模式。',
            '执行操作：Atd 读取窗口的控件、识别出的文字和截图，再点击、输入、选择菜单或滚动。',
            '核实结果：每次会产生改动的操作之后，Atd 先确认预期结果已经出现，再继续。',
            '查看过程：对话里会显示每一步，Atd 也会说明哪些无法核实、哪些需要你来完成。',
          ],
        },
        {
          id: 'access-and-control',
          title: '访问由你批准，也能随时收回',
          paragraphs: [
            'Atd 只能在本次任务获批的应用和网站里操作。「手动批准」模式下，每个新应用或网站都要你批准，授权仅在本次运行有效。「自动批准」模式下，由模型对照你的请求检查每次访问请求，有风险时仍会询问你；在「自动批准」或「始终允许」下批准的访问会保存下来，供后续任务使用。',
            '「设置 → 电脑操作」会列出已保存的访问权限，你也可以在这里自行添加应用或网站，并查看所需的 macOS 权限是否已开启。「断开」会撤销某个目标已保存的访问权限；如果是网站，其浏览器环境里的登录数据会保留。「全部停止」会结束 Atd 在网站和应用上的所有操作，任务和自动化都包括在内。',
          ],
          points: [
            '浏览器环境只会打开你为它允许的网站。',
            'Atd 无法确认结果的操作绝不会被自动重做：在你亲自查看并选择「标记为已核对」之前，该应用或网站里的后续操作会先暂缓。',
          ],
        },
        {
          id: 'websites-and-apps',
          title: '网站用独立的 Chrome 配置文件，Mac 应用在后台操作',
          paragraphs: [
            '操作网站前，先在「设置 → 电脑操作」的「引擎」中安装可选的浏览器引擎，再选择「添加浏览器环境」。Atd 会为此单独打开一个 Chrome 配置文件，绝不使用你日常的配置文件，因此需要已安装 Google Chrome。在其中登录，并逐行填写允许使用的网站；这些网站之外的页面，Atd 不会打开。',
            '操作 Mac 应用时，可以选择「添加应用」，也可以让任务自行请求。只要应用支持，Atd 就在后台操作它的窗口。在你发起的任务中，遇到后台无法完成的步骤，Atd 可能会短暂把应用调到前面，把这一步的点击和按键直接发给它，不移动你的指针，然后切回你原来的应用。网站始终在后台操作。',
            '默认由任务所用的模型读取画面。你可以在「画面理解」中另选一个支持图像的模型；开启「显示实时指针」后，Atd 操作你能看到的目标时，会标出它正在操作的位置。',
          ],
        },
        {
          id: 'limits',
          title: '哪些步骤仍由你来做',
          paragraphs: [
            'Atd 无法悬停、在窗口或应用之间拖动、在锁屏或密码框等安全输入中操作，也从不打开右键菜单。任务遇到这类步骤、需要登录或授权时，Atd 会请你来完成，之后重新查看状态再继续。',
            '自动化不能请求新的访问权限。自动化中的电脑操作需要在「设置 → 自动化」中单独授权，而且只能用于已通过自动化核验的应用或网站。',
          ],
        },
      ],
      questions: [
        {
          question: 'Atd 会接管我的鼠标和键盘吗？',
          answer:
            '不会。只要应用或网站支持，Atd 就在后台操作，从不移动你的指针。在你发起的任务中，只能在前台完成的步骤可能会让 Mac 应用短暂来到前面，Atd 把这一步的点击和按键直接发给它，随后切回你原来的应用。网站和自动化始终在后台进行。',
        },
        {
          question: 'Atd 能使用我已登录的网站吗？',
          answer:
            '不会通过你日常的浏览器配置文件。每个浏览器环境都是 Atd 单独打开的 Chrome 配置文件：你在其中登录一次，选好允许使用的网站，登录数据只保存在本机的这个配置文件里。断开该环境会撤销 Atd 的访问权限，但登录数据会保留。',
        },
        {
          question: '电脑操作需要哪些 macOS 权限？',
          answer:
            '一是控制应用的权限，即“辅助功能”（新版 macOS 中为“设备控制和数据访问”），让 Atd 能读取和操作应用控件；二是“屏幕录制”，让 Atd 能拍下目标画面作为证据。「设置 → 电脑操作」会显示两项权限是否已开启，并能直接打开系统设置；在那里点「准备屏幕访问」，macOS 就会提前询问，而不是在任务进行中弹窗。',
        },
        {
          question: 'Atd 正在操作时，怎么让它停下？',
          answer:
            '在对话中停止本次运行，或在「设置 → 电脑操作」中点「全部停止」，结束所有任务和自动化中的电脑操作。如果想彻底收回访问权限，在同一页面断开对应的应用或网站即可。',
        },
        {
          question: 'Atd 能看着我的屏幕操作吗？',
          answer:
            '可以，前提是在你发起的任务里，你明确请它跟着看你的屏幕。你可以在 macOS 的选择器中最多选四个窗口或显示器。共享只读、不会获得操作权限，需要支持图像的模型，任务结束或你在 macOS 中停止共享时就会结束。',
        },
      ],
      keywords: [
        'Mac 电脑操作 AI',
        'AI 操作 Mac 应用',
        'AI 浏览器智能体',
        'Mac 自动化 AI 智能体',
        'macOS 桌面智能体',
        '开源电脑操作智能体',
      ],
    },
  },
} as const satisfies FeaturePage;
