import type { FeaturePage } from './types.ts';

export const mcpAndSkills = {
  slug: 'mcp-and-skills',
  illustration: {
    scene: {
      en: 'The Personal extensions page lists five MCP servers: github, filesystem and docs-search are ready, sqlite needs approval and calendar is disabled, beside tabs for commands, skills, subagents and memory.',
      zh: '“个人”扩展页列出五个 MCP 服务器：github、filesystem 和 docs-search 已就绪，sqlite 需要允许，calendar 已停用，旁边是命令、技能、子代理和记忆标签。',
    },
  },
  updated: '2026-11-18',
  related: ['selection-toolbar', 'automations', 'apps'],
  posts: ['atd-0-11-0'],
  copy: {
    en: {
      name: 'MCP and skills',
      summary:
        'Connect MCP servers, add skills and subagents, and save commands you can run from anywhere on your Mac.',
      headTitle: 'MCP Client, AI Skills and Subagents for Mac — Atd',
      headDescription:
        'Atd is a free, open-source MCP client for macOS. Connect MCP servers, add skills and subagents, install plugin bundles and save reusable commands.',
      title: 'MCP client and AI skills for Mac',
      lede: 'Atd connects to MCP servers, loads skills, delegates to subagents and runs your saved commands, so the agent on your Mac works with your tools and your way of working. Add each one yourself, or ask Atd to set it up in a conversation.',
      sections: [
        {
          id: 'mcp-servers',
          title: 'Connect MCP servers',
          paragraphs: [
            'Atd is an MCP client: add a Model Context Protocol server in Settings › Extensions, and tasks can use the tools, resources and prompts it offers. Run a local server as a command on your Mac (stdio), or connect a remote one over Streamable HTTP or HTTP with SSE.',
            'A remote server can sign in with OAuth in your browser, or with a bearer token that Atd reads from an environment variable you name. MCP credentials are kept in your Mac’s keychain, and a local server runs only after you allow it in a system dialog that shows exactly what will run.',
          ],
          points: [
            'Type @ in the composer and pick a server to point the agent at its tools.',
            'Servers with many tools can load them on demand, so they don’t fill every request.',
            'Choose whether the agent may read the files and data a server shares as resources.',
            'Ask Atd to add a server: it takes the launch command or URL from the server’s documentation and asks you to confirm before saving.',
          ],
        },
        {
          id: 'skills',
          title: 'Add skills for recurring work',
          paragraphs: [
            'A skill is a folder with a SKILL.md file that tells the agent how to carry out a kind of work, such as your team’s release notes or a review checklist. Every task lists your skills by name and description, and the agent loads a skill’s instructions when the task matches.',
            'Personal skills live in ~/.atd/skills, and skills in ~/.agents/skills are shared with other agent tools. Type / in the composer to pick a skill yourself, or set a skill to start only when you pick it.',
            'Atd also ships built-in skills, including the ones it uses to create skills, subagents, MCP servers, commands, automations and apps when you ask. You can edit a built-in skill and restore the shipped version later.',
          ],
        },
        {
          id: 'subagents',
          title: 'Delegate to subagents',
          paragraphs: [
            'A subagent is a specialist the agent can hand a kind of work to, defined in a Markdown file in ~/.atd/agents: when to delegate to it, the tools it may use and its instructions. Each delegation starts fresh with only those instructions and the work it is handed, and the conversation shows its activity as it runs.',
            'Subagents run on the model of the task that delegates to them and write only inside the task’s folder. In Settings › Extensions you can limit a subagent’s tools or give it a stricter approval than the task; it never gets more than the task itself allows.',
          ],
        },
        {
          id: 'commands',
          title: 'Saved commands and slash commands',
          paragraphs: [
            'A saved command is a reusable prompt with optional parameters. Run it from the panel, from its own global shortcut, from the selection toolbar on text you select in another app, on text you pick in a screenshot, or from the screenshot toolbar.',
            'In the composer, type / for quick commands such as /new, /model and /compact and to pick a skill, or @ to add a saved command, a subagent, an MCP server, a file or an earlier conversation to your message.',
            'Each command sets what it reads (typed text, the selection, the clipboard or a screenshot) and where its answer goes. It can also load a skill, allow a subagent, suggest an MCP server’s tools or include an excerpt of another conversation.',
          ],
          points: [
            'Show the answer in the conversation, or in a card over the app you ran it from.',
            'Replace the selected text, insert after it, or insert at the cursor.',
            'Copy it to the clipboard, or mark the text you pick in a screenshot.',
            'Review an answer before it’s written in, and adjust it with suggestions you choose.',
            'Give a command up to 8 shortcuts, each with its own parameter values or destination.',
          ],
        },
        {
          id: 'plugins',
          title: 'Install plugin bundles',
          paragraphs: [
            'A plugin bundles commands, skills, subagents and MCP servers. Install one from a local folder, from a Git repository pinned to its commit, or from an npm package checked against the registry’s integrity hash. Atd reads several common bundle layouts, including the open Agent Plugins and Agent Skills formats.',
            'Before installing, Atd lists what the plugin contains, the programs it can run on your Mac and the servers it connects to. Nothing runs during install, plugins start turned off, and their items stay read-only until you duplicate one to Personal. Plugins aren’t signed, so install them only from sources you trust.',
          ],
        },
      ],
      questions: [
        {
          question: 'Which MCP transports does Atd support?',
          answer:
            'Atd supports local MCP servers that it starts as a command on your Mac and talks to over stdio, and remote servers over Streamable HTTP or the older HTTP with Server-Sent Events. A remote server can use no authentication, a bearer token read from an environment variable, or OAuth sign-in in your browser.',
        },
        {
          question: 'Can an MCP server or tool access my files?',
          answer:
            'A tool or MCP server can reach the files and external services that its own configuration and the task’s permissions allow. Local MCP servers need your approval before they run, and plugin contents are listed for review before you install them. Add only servers you trust, and check what each one offers in Settings › Extensions.',
        },
        {
          question: 'What’s the difference between a skill, a subagent and a command?',
          answer:
            'A skill is a procedure the agent loads into the current task when the work matches its description. A subagent is a separate specialist the agent hands part of the work to, with its own instructions and tools. A command is a prompt you run yourself, from the panel, a shortcut, the selection toolbar or the screenshot toolbar.',
        },
        {
          question: 'Can I use skills I already have for other agent tools?',
          answer:
            'Yes. Skills in ~/.agents/skills appear in Atd as Shared skills, and a folder in the Agent Skills format can also be installed as a plugin from a local folder, Git or npm.',
        },
        {
          question: 'Do I have to write configuration files?',
          answer:
            'No. Ask Atd in a conversation to add an MCP server, create a skill or subagent, or save a command; it asks only about choices that change the result, and saving a server, subagent or command asks you to confirm what will be stored. You can also add each one by hand in Settings.',
        },
      ],
      keywords: [
        'MCP client for Mac',
        'macOS MCP client',
        'AI agent skills',
        'SKILL.md skills',
        'AI subagents',
        'slash commands',
        'AI plugins for Mac',
        'custom AI commands',
      ],
    },
    zh: {
      name: 'MCP 与技能',
      summary: '连接 MCP 服务器，添加技能和子代理，保存可在 Mac 上随处运行的命令。',
      headTitle: 'Mac 上的 MCP 客户端与 AI 技能 — Atd',
      headDescription:
        'Atd 是免费开源的 macOS MCP 客户端：连接 MCP 服务器，添加技能与子代理，安装插件，保存可复用的命令。',
      title: 'Mac 上的 MCP 客户端与 AI 技能扩展',
      lede: 'Atd 可以连接 MCP 服务器、加载技能、把工作委派给子代理，并运行你保存的命令，让 Mac 上的智能体用上你的工具，按你的方式做事。每一项都可以自己添加，也可以在对话里让 Atd 帮你配置。',
      sections: [
        {
          id: 'mcp-servers',
          title: '连接 MCP 服务器',
          paragraphs: [
            'Atd 是一个 MCP 客户端：在“设置 › 扩展”中添加 Model Context Protocol 服务器后，任务就能使用它提供的工具、资源和提示。本地服务器以命令形式在 Mac 上启动（stdio），远程服务器则通过 Streamable HTTP 或 HTTP + SSE 连接。',
            '远程服务器可以在浏览器中通过 OAuth 登录，也可以使用 Bearer 令牌，由 Atd 从你指定的环境变量中读取。MCP 凭据保存在 Mac 的钥匙串中；本地服务器要先经你在系统对话框中允许才能运行，对话框会列出将要运行的具体内容。',
          ],
          points: [
            '在输入框中输入 @ 并选择服务器，让智能体优先使用它的工具。',
            '工具较多的服务器可以按需加载工具，不必每次请求都附带全部工具。',
            '可以决定是否允许智能体读取服务器以资源形式共享的文件和数据。',
            '也可以直接让 Atd 添加：它会按服务器文档确定启动命令或 URL，保存前请你确认。',
          ],
        },
        {
          id: 'skills',
          title: '为重复的工作添加技能',
          paragraphs: [
            '技能是一个包含 SKILL.md 文件的文件夹，告诉智能体如何完成某一类工作，比如团队的发布说明写法或代码审查清单。每个任务都会按名称和描述列出你的技能，任务对得上时再加载技能的具体说明。',
            '个人技能保存在 ~/.atd/skills，~/.agents/skills 中的技能则与其他代理工具共用。在输入框中输入 / 可以手动选择技能，也可以把技能设为只在你选择时才启用。',
            'Atd 还自带内置技能，其中包括它在你提出需求时用来创建技能、子代理、MCP、命令、自动化和应用的技能。内置技能可以修改，之后也能恢复为应用自带的版本。',
          ],
        },
        {
          id: 'subagents',
          title: '把工作委派给子代理',
          paragraphs: [
            '子代理是智能体可以把某一类工作交给它的专门助手，定义在 ~/.atd/agents 中的一个 Markdown 文件里：何时委派给它、它能用哪些工具，以及它的指令。每次委派都从零开始，只带着这些指令和交给它的工作；运行过程会显示在对话中。',
            '子代理使用发起委派的任务所用的模型，只能在任务文件夹内写入文件。在“设置 › 扩展”中可以限制子代理的工具，或给它比任务更严格的批准方式；它的权限永远不会超出任务本身。',
          ],
        },
        {
          id: 'commands',
          title: '已保存的命令与斜杠命令',
          paragraphs: [
            '命令是可复用的提示词，可以带参数。你可以在面板中运行它，用它自己的全局快捷键运行，在其他应用中选中文字后从选区工具栏运行，对截图里选取的文字运行，或从截图工具栏运行。',
            '在输入框中输入 / 可以使用 /new、/model、/compact 等斜杠命令并选择技能；输入 @ 则可以把已保存的命令、子代理、MCP 服务器、文件或以前的对话加入消息。',
            '每个命令都可以设定读取什么（输入的文字、选中的文字、剪贴板或截图），以及回答去往哪里。命令还可以加载技能、允许调用子代理、建议使用某个 MCP 服务器的工具，或引用另一段对话的摘录。',
          ],
          points: [
            '在对话中显示回答，或在运行命令的应用上方用卡片显示。',
            '替换选中的文字、插入到选中文字之后，或插入到光标处。',
            '拷贝到剪贴板，或在截图里选取的文字上做标注。',
            '写入前先确认回答，并用你挑选的调整建议重新生成。',
            '每个命令最多 8 个快捷键，各自可以固定参数值或回答去向。',
          ],
        },
        {
          id: 'plugins',
          title: '安装插件包',
          paragraphs: [
            '插件把命令、技能、子代理和 MCP 打包在一起。可以从本地文件夹、锁定到具体提交的 Git 仓库，或经注册表完整性校验的 npm 软件包安装。Atd 支持多种常见的插件结构，包括开放的 Agent Plugins 和 Agent Skills 格式。',
            '安装前，Atd 会列出插件包含的内容、可在这台 Mac 上运行的程序以及会连接的服务器。安装过程不会运行任何代码，插件默认关闭；其中的项目为只读，复制到“个人”后才能修改。插件没有签名，请只安装来自可信来源的插件。',
          ],
        },
      ],
      questions: [
        {
          question: 'Atd 支持哪些 MCP 传输方式？',
          answer:
            'Atd 支持以命令形式在 Mac 上启动、通过 stdio 通信的本地 MCP 服务器，以及通过 Streamable HTTP 或较早的 HTTP + SSE 连接的远程服务器。远程服务器可以不做身份验证，也可以使用从环境变量读取的 Bearer 令牌，或在浏览器中通过 OAuth 登录。',
        },
        {
          question: 'MCP 服务器和工具能访问我的文件吗？',
          answer:
            '工具和 MCP 服务器能访问哪些文件和外部服务，取决于它们自身的配置和当前任务的权限。本地 MCP 服务器要经你允许才能运行，插件在安装前也会列出全部内容供你查看。请只添加你信任的服务器，并在“设置 › 扩展”中查看每个服务器提供的能力。',
        },
        {
          question: '技能、子代理和命令有什么区别？',
          answer:
            '技能是一套做事方法，工作与它的描述对得上时，智能体会把它加载到当前任务中；子代理是独立的专门助手，智能体会把部分工作交给它，它有自己的指令和工具；命令是你自己运行的提示词，可以从面板、快捷键、选区工具栏或截图工具栏启动。',
        },
        {
          question: '能用我为其他代理工具准备的技能吗？',
          answer:
            '可以。~/.agents/skills 中的技能会在 Atd 中显示为“共享技能”；符合 Agent Skills 格式的文件夹也可以作为插件，从本地文件夹、Git 或 npm 安装。',
        },
        {
          question: '需要自己编写配置文件吗？',
          answer:
            '不需要。在对话中让 Atd 添加 MCP 服务器、创建技能或子代理、保存命令即可：它只会询问影响结果的选择，保存服务器、子代理或命令前会请你确认将要保存的内容。你也可以在设置中逐项手动添加。',
        },
      ],
      keywords: [
        'Mac MCP 客户端',
        'macOS MCP',
        'AI 技能',
        'SKILL.md',
        '子代理',
        '斜杠命令',
        'AI 插件',
        '自定义 AI 命令',
      ],
    },
  },
} as const satisfies FeaturePage;
