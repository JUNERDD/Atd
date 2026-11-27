import type { FaqGroup } from './types.ts';

/** Which Macs Atd runs on, how to install it, signing and notarization, and updates. */
export const install = {
  id: 'download-and-install',
  title: { en: 'Download, install and updates', zh: '下载、安装与更新' },
  entries: [
    {
      id: 'intel-macs',
      question: { en: 'Does Atd work on Intel Macs?', zh: 'Atd 能在 Intel Mac 上运行吗？' },
      answer: {
        en: [
          'Yes. Atd runs on both Apple silicon and Intel Macs with macOS 15 or later, and each has its own installer: Atd-arm64.dmg for Apple silicon and Atd-x64.dmg for Intel. Earlier macOS versions aren’t supported.',
          'To check which one you need, open About This Mac: it lists a Chip on Apple silicon and a Processor on Intel. If you install the Intel build on an Apple silicon Mac, its next update moves it to the Apple silicon build.',
        ],
        zh: [
          '可以。Atd 支持运行 macOS 15 或更高版本的 Apple 芯片 Mac 和 Intel Mac，两者各有独立的安装包：Apple 芯片用 Atd-arm64.dmg，Intel 用 Atd-x64.dmg。更早的 macOS 版本不受支持。',
          '不确定该选哪个？打开“关于本机”：显示“芯片”的是 Apple 芯片，显示“处理器”的是 Intel。如果在 Apple 芯片的 Mac 上装了 Intel 版，下次更新时会自动换成 Apple 芯片版。',
        ],
      },
    },
    {
      id: 'install',
      question: { en: 'How do I install Atd?', zh: '如何安装 Atd？' },
      answer: {
        en: [
          'Download the installer for your Mac from atd.best: https://downloads.atd.best/latest/Atd-arm64.dmg for Apple silicon or https://downloads.atd.best/latest/Atd-x64.dmg for Intel. Releases are signed with Apple Developer ID and notarized by Apple. Open the DMG and drag Atd to Applications.',
          'Open Atd, add a model connection in Settings → Models and choose your default model, then press ⌘ ⇧ Space to open the panel. Atd includes everything it needs to run, so you don’t need to install Node.js; only external tools that a task uses must be on your Mac.',
        ],
        zh: [
          '从 atd.best 下载适合你 Mac 的安装包：Apple 芯片请用 https://downloads.atd.best/latest/Atd-arm64.dmg，Intel 请用 https://downloads.atd.best/latest/Atd-x64.dmg。正式版安装包已使用 Apple Developer ID 签名并通过 Apple 公证。打开 DMG，把 Atd 拖到“应用程序”文件夹。',
          '打开 Atd，在“设置 → 模型”中添加模型连接并选择默认模型，然后按 ⌘ ⇧ Space 打开面板。Atd 自带运行所需的一切，无需安装 Node.js；只有任务要用到的外部工具需要事先装在 Mac 上。',
        ],
      },
    },
    {
      id: 'blocked-first-launch',
      question: {
        en: 'Is Atd signed and notarized by Apple?',
        zh: 'Atd 是否经过 Apple 签名与公证？',
      },
      answer: {
        en: [
          'Yes. Releases from 0.12.0 onward are signed with an Apple Developer ID certificate and notarized by Apple, so macOS verifies them on first launch without requiring Open Anyway.',
          'If you are opening an older build from before 0.12.0 and macOS blocks it, open System Settings › Privacy & Security, choose Open Anyway and confirm Open—only for installers downloaded from atd.best or the project’s GitHub releases page. When upgrading from a pre-0.11 self-signed build, macOS may ask once to reconfirm Accessibility, Screen Recording or Keychain access.',
        ],
        zh: [
          '是的。自 0.12.0 起，正式版应用与 DMG 安装包均已使用 Apple Developer ID 证书签名并通过 Apple 公证，首次打开时由 macOS 正常校验，无需再点按“仍要打开”。',
          '如果你打开的是 0.12.0 之前的旧版本且被 macOS 阻止，请前往“系统设置 › 隐私与安全性”点按“仍要打开”并确认“打开”（请仅对来自 atd.best 或项目 GitHub 发布页官方链接的安装包这样操作）。从 0.11 之前的自签名版本升级时，macOS 可能会提示重新确认一次辅助功能、屏幕录制或钥匙串访问权限。',
        ],
      },
    },
    {
      id: 'update',
      question: { en: 'How do I update Atd?', zh: '如何更新 Atd？' },
      answer: {
        en: [
          'Atd updates itself. It checks for new versions automatically, downloads them in the background and installs them when you quit Atd, so you don’t need to download the installer again.',
          'While an update downloads, its progress shows in the panel header; once it’s ready, choose Update there to restart into the new version right away. To check yourself, choose Check for Updates… from the menu bar icon’s menu, or Check for updates in Settings → About.',
          'After you update to a new stable version, a Release notes button in the panel header opens that release’s notes.',
        ],
        zh: [
          'Atd 会自动更新：它会自动检查新版本，在后台下载，并在你退出 Atd 时安装，无需重新下载安装包。',
          '下载进度会显示在面板顶部；准备就绪后，点按那里的“更新”即可立即重启到新版本。想手动检查，可以在菜单栏图标的菜单中选择“检查更新…”，或在“设置 → 关于”中点按“检查更新”。',
          '更新到新的正式版后，面板顶部会出现“更新日志”按钮，点按即可查看这一版的更新内容。',
        ],
      },
    },
  ],
} as const satisfies FaqGroup;
