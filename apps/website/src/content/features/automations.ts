import type { FeaturePage } from './types.ts';

export const automations = {
  slug: 'automations',
  illustration: { case: 'automations' },
  updated: '2026-11-24',
  related: ['mcp-and-skills', 'computer-use', 'privacy'],
  posts: ['atd-0-12-1', 'atd-0-12-0', 'atd-0-10-6'],
  copy: {
    en: {
      name: 'Automations',
      summary:
        'Run prompts and saved commands on a schedule, when files change, when your Mac is idle or after another automation.',
      headTitle: 'Scheduled AI Tasks and Automations on Mac — Atd',
      headDescription:
        'Automate AI work on your Mac with Atd: run prompts and commands on a schedule, when files change in a folder, when your Mac is idle or after another run.',
      title: 'Scheduled AI tasks and automations for Mac',
      lede: 'Atd runs prompts and saved commands on its own: on a schedule, when files arrive or change in a folder, when your Mac is idle, or after another automation finishes. Each run is a task you can open, with status and run history in Settings › Automations.',
      sections: [
        {
          id: 'triggers',
          title: 'Choose what starts a run',
          paragraphs: [
            'An automation starts from one of four triggers. Runs start on their own while Atd is open, and each one begins a new task in the task panel with nobody there to answer questions, so everything a run needs is settled when you create it.',
          ],
          points: [
            'Schedule: once, at an interval from 15 minutes to a week, daily, weekly, monthly, or a custom cron expression, in the time zone you choose.',
            'Folder: when files are added to or change in a folder you choose, optionally only files matching name patterns such as *.pdf, including subfolders up to 4 levels down. If a watched folder goes missing or loses read permission, Atd tells you why.',
            'Mac is idle: at most once a day, the first time your Mac has had no keyboard, mouse or trackpad input for 5 to 120 minutes while none of your tasks is running.',
            'Another automation: after another automation’s run has a result, finds nothing new, needs you or fails. Automations can’t follow each other in a loop.',
          ],
        },
        {
          id: 'actions',
          title: 'Decide what each run does',
          paragraphs: [
            'A run follows a prompt you write for it, or runs one of your saved commands with its parameters and input. Each run starts fresh, so a prompt should say what to do, where to look and what a good result looks like. A folder run also hands its command the files that changed. You can bind an automation to a reusable model alias so editing the alias updates every automation that uses it.',
            'To automate a saved command, choose Automate… from its More menu in Settings › Commands, or ask Atd in a conversation to set up the automation for you. Commands that read the selection, the clipboard or a screenshot need you there, so they can’t run as automations.',
            'New installations include an editable Consolidate memory automation that merges duplicate memories and rewrites outdated ones, at most once a day after two hours of Mac inactivity. Memories it would remove become suggestions you confirm in Settings › Memory.',
          ],
        },
        {
          id: 'unattended-runs',
          title: 'Set what unattended runs may do',
          paragraphs: [
            'Each automation has its own approval setting. Under Auto approval, a model checks each action against the automation: safe actions run, and anything it would ask you about is declined. Manual approval declines every file change and terminal command, so runs can only read and report. Always allow runs everything without asking and asks you to confirm before you switch to it.',
          ],
          points: [
            'Choose the tools a prompt run may use and the folders every run may read; a watched folder is always readable.',
            'Runs can use what Atd remembers about you, but never add to memory.',
            'A run still going after its time limit, from 5 minutes to 4 hours, is stopped and counts as failed.',
            'Runs missed while Atd was closed or your Mac was asleep can run once when Atd is back, marked late, or be skipped.',
            'Computer actions need separate authorization: run a trial of the exact steps, then choose Save and authorize. Only website targets run unattended.',
          ],
        },
        {
          id: 'results',
          title: 'Follow results and run history',
          paragraphs: [
            'Choose when Atd notifies you: when there’s something new, after every run, or only when something goes wrong. Runs that fail or need you always notify. Pass on the previous result lets each run see the last one and report only what changed.',
            'Settings › Automations shows each automation’s next and last run. Run history keeps the last 100 runs with their outcomes and a link to each run’s task, and Run now starts one right away. Pause all automations stops anything from starting on its own, and an automation that fails several runs in a row is turned off until you check it.',
          ],
        },
        {
          id: 'ideas',
          title: 'Ideas to start from',
          paragraphs: [
            'Automations suit work you would otherwise have to remember to start yourself. A few examples:',
          ],
          points: [
            'Every weekday morning, prepare a brief of what needs your attention.',
            'File invoices as they arrive in a watched folder.',
            'Check a source on a schedule and report only what changed since the last run.',
            'Summarize what arrived in your Downloads folder today and list anything that needs a reply.',
          ],
        },
      ],
      questions: [
        {
          question: 'Do automations run when Atd is closed?',
          answer:
            'No. Automations run only while Atd is running. For a schedule, choose whether the latest run missed while Atd was closed or your Mac was asleep runs once when Atd is back, marked late, or is skipped. For a folder trigger, skipping starts watching from now instead of handling changes made while Atd was closed.',
        },
        {
          question: 'What happens when a run needs my approval?',
          answer:
            'Nobody is there to answer, so the run declines whatever its approval setting would ask about instead of waiting. The run is marked as needing you, which always sends a notification, and you can open its task from the run history to see which actions were declined.',
        },
        {
          question: 'How often can an automation run?',
          answer:
            'Scheduled runs are at least 15 minutes apart, and the Mac is idle trigger runs at most once a day. If the previous run is still going, a new scheduled run is skipped, and an automation skips any run beyond 12 in the past hour.',
        },
        {
          question: 'Can an automation use my ChatGPT plan?',
          answer:
            'Yes, once you allow it. Turn on Allow background use for that connection under Settings › Models; it’s off by default and separate from signing in. Withdrawing it stops later background requests from using your plan.',
        },
        {
          question: 'Can an automation work in websites or apps?',
          answer:
            'Only within a scope you authorize. Do the work once with Atd in a task, ask Atd to turn that task into an automation, then run a trial of exactly those steps and choose Save and authorize in Settings › Automations. Unattended runs act only on websites, only through the authorized steps, and stop for your review when Atd can’t confirm an action took effect.',
        },
      ],
      keywords: [
        'AI automation for Mac',
        'scheduled AI tasks',
        'AI cron jobs on Mac',
        'folder watch automation',
        'automate prompts on macOS',
        'run AI when Mac is idle',
        'AI workflow automation',
      ],
    },
    zh: {
      name: '自动化',
      summary: '让提示词和命令按计划、在文件变化时、在 Mac 空闲时或接在另一个自动化之后自动运行。',
      headTitle: 'Mac 上的 AI 定时任务与自动化 — Atd',
      headDescription:
        '用 Atd 在 Mac 上自动运行 AI 提示词和命令：按计划定时执行、文件夹有文件变化时触发、Mac 空闲时运行，或接在另一个自动化之后。',
      title: 'Mac 上的 AI 定时任务与自动化',
      lede: 'Atd 可以自动运行提示词和已保存的命令：按计划运行、在文件夹中有文件新增或变化时运行、在 Mac 空闲时运行，或在另一个自动化结束后运行。每次运行都是一个可以打开查看的任务，运行状态和运行记录都在“设置 › 自动化”中。',
      sections: [
        {
          id: 'triggers',
          title: '选择什么时候运行',
          paragraphs: [
            '自动化有四种触发方式。Atd 打开期间，运行会自动开始；每次运行都会在任务面板中新建一个任务，运行时没有人在场回答问题，所以一次运行需要的一切都要在创建时定好。',
          ],
          points: [
            '计划：仅一次、按 15 分钟到 1 周的间隔、每天、每周、每月，或自定义 cron 表达式，按你选择的时区计算。',
            '文件夹：你选择的文件夹中有文件新增或变化时运行，可以只匹配 *.pdf 这类文件名模式，也可以包含最多 4 层子文件夹。如果被监视的文件夹找不到或缺少读取权限，Atd 会明确提示原因。',
            'Mac 空闲时：每天最多一次，在这台 Mac 首次连续 5 到 120 分钟没有键盘、鼠标或触控板操作，且你的任务都没有在运行时开始。',
            '另一个自动化：在另一个自动化的某次运行有结果、没有新内容、需要你处理或失败后运行。自动化之间不能循环触发。',
          ],
        },
        {
          id: 'actions',
          title: '决定每次运行做什么',
          paragraphs: [
            '每次运行可以执行你为它写的提示词，也可以带着参数和输入运行一个已保存的命令。每次运行都从零开始，所以提示词要写清楚做什么、去哪里找，以及怎样才算好结果。由文件夹触发的运行还会把变化的文件交给命令。你还可以将自动化绑定到可复用的模型别名，修改别名即可同步更新所有绑定它的自动化。',
            '要让已保存的命令自动运行，可以在“设置 › 命令”中打开它的“更多”菜单，选择“设为自动化…”；也可以直接在对话中让 Atd 帮你设置。读取选中文字、剪贴板或截图的命令需要你在场，因此不能设为自动化。',
            '新安装的 Atd 自带一个可编辑的“整理记忆”自动化：每天最多一次，在 Mac 连续两小时无操作后合并重复的记忆、改写过时的记忆。它认为该删除的记忆会变成建议，由你在“设置 › 记忆”中确认。',
          ],
        },
        {
          id: 'unattended-runs',
          title: '设定无人值守时能做什么',
          paragraphs: [
            '每个自动化都有自己的批准方式。选择“自动批准”时，由模型对照这个自动化检查每个操作：安全的直接执行，原本需要询问你的操作会被拒绝。“手动批准”会拒绝所有文件更改和终端命令，运行只能读取内容并汇报。“始终允许”会不经询问执行所有操作，切换前会先请你确认。',
          ],
          points: [
            '选择提示词运行可用的工具，以及每次运行都能读取的文件夹；被监视的文件夹始终可读。',
            '运行时可以使用 Atd 记住的关于你的信息，但不会写入记忆。',
            '超过最长运行时间（5 分钟到 4 小时）仍未结束的运行会被停止，并记为失败。',
            'Atd 关闭或 Mac 睡眠期间错过的运行，可以在 Atd 恢复后补运行一次并标为延迟，也可以直接跳过。',
            '电脑操作需要单独授权：先现场试跑完全相同的步骤，再选择“保存并授权”。无人值守时只能操作网站。',
          ],
        },
        {
          id: 'results',
          title: '查看结果与运行记录',
          paragraphs: [
            '你可以选择 Atd 何时通知你：有新内容时、每次运行后，或仅在出现问题时。失败或需要你处理的运行总会发出通知。开启“提供上次的结果”后，每次运行都能看到上一次的结果，只汇报有变化的部分。',
            '“设置 › 自动化”会显示每个自动化的下次和上次运行。运行记录最多保留最近 100 次运行，包含结果和对应任务的链接；“立即运行”可以马上运行一次。“暂停所有自动化”会让所有自动化都不再自行启动；连续多次运行失败的自动化会被关闭，等你检查后再开启。',
          ],
        },
        {
          id: 'ideas',
          title: '可以从这些用法开始',
          paragraphs: ['那些原本要你记着去启动的工作，最适合交给自动化。比如：'],
          points: [
            '每个工作日早上，整理一份需要你关注的事项摘要。',
            '发票放进被监视的文件夹后，自动归档。',
            '定时查看某个来源，只汇报自上次运行以来的变化。',
            '总结今天下载文件夹里新增的内容，列出需要回复的事项。',
          ],
        },
      ],
      questions: [
        {
          question: 'Atd 关闭时自动化还会运行吗？',
          answer:
            '不会。自动化只在 Atd 运行期间运行。对于按计划运行的自动化，你可以选择：Atd 关闭或 Mac 睡眠期间错过的最近一次运行，在 Atd 恢复后补运行一次并标为延迟，或直接跳过。对于文件夹触发，选择跳过会从现在开始监视，不再处理 Atd 关闭期间发生的变化。',
        },
        {
          question: '运行中遇到需要批准的操作怎么办？',
          answer:
            '没有人在场回答，所以运行不会等待，而是拒绝批准方式本来要询问的操作。这次运行会标为“需要你处理”并总会发出通知；你可以在运行记录中打开对应任务，查看哪些操作被拒绝了。',
        },
        {
          question: '自动化最多能多频繁地运行？',
          answer:
            '按计划运行时，两次运行至少间隔 15 分钟；“Mac 空闲时”触发每天最多运行一次。上一次运行还没结束时，新的计划运行会被跳过；一个自动化在过去一小时内运行满 12 次后，之后的运行也会被跳过。',
        },
        {
          question: '自动化可以使用我的 ChatGPT 订阅吗？',
          answer:
            '可以，但需要你先允许。在“设置 › 模型”中为该连接开启“允许后台调用”；这项设置默认关闭，与登录是分开的。撤回后，之后的后台请求就不会再使用你的订阅额度。',
        },
        {
          question: '自动化可以操作网站或应用吗？',
          answer:
            '只能在你授权的范围内操作。先和 Atd 在任务中完成一次，再让 Atd 把那个任务变成自动化，然后在“设置 › 自动化”中现场试跑完全相同的步骤，并选择“保存并授权”。无人值守的运行只操作网站，只执行授权过的步骤；Atd 无法确认某个操作是否生效时，会停下来等你检查。',
        },
      ],
      keywords: [
        'Mac 自动化',
        'AI 定时任务',
        'Mac 定时运行 AI',
        '文件夹监控自动化',
        'macOS 自动运行提示词',
        'AI 工作流自动化',
        'Mac 空闲时运行',
      ],
    },
  },
} as const satisfies FeaturePage;
