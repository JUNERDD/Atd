import type { Localized } from '../../i18n/routes.ts';

interface DebugCopy {
  label: string;
  title: string;
  description: string;
  home: string;
  skip: string;
  stable: string;
  choose: string;
  chips: { arm64: string; x64: string };
  download: (chip: string) => string;
  requires: (version: string) => string;
  version: string;
  recording: string;
  profiles: { runtime: string; focus: string };
  loading: string;
  unavailable: string;
  error: string;
  retry: string;
  noScript: string;
  which: string;
  before: string;
  environment: string;
  stepsTitle: string;
  steps: string[];
  privacy: string;
  returnNote: string;
  checksum: string;
}

export const debugCopy = {
  en: {
    label: 'Atd / Support',
    title: 'Diagnostic downloads',
    description:
      'Use this build when support asks you to record a problem. Check the version with them before downloading.',
    home: 'Atd home',
    skip: 'Skip to downloads',
    stable: 'Get the regular version',
    choose: 'Choose your Mac’s chip',
    chips: { arm64: 'Apple silicon', x64: 'Intel' },
    download: (chip) => `Download for ${chip}`,
    requires: (version) => `macOS ${version} or later`,
    version: 'Version',
    recording: 'Records',
    profiles: { runtime: 'Runtime activity', focus: 'Runtime activity and window focus' },
    loading: 'Checking for a diagnostic build…',
    unavailable:
      'No diagnostic build is available yet. Support will let you know when it is ready.',
    error: 'The download information could not be loaded. Please try again.',
    retry: 'Try again',
    noScript: 'Enable JavaScript to check the current diagnostic build and download it.',
    which: 'In About This Mac, “Chip” means Apple silicon; “Processor” means Intel.',
    before: 'Before you open it',
    environment:
      'Quit the regular Atd app first. This build uses your existing settings and conversations, and does not update automatically.',
    stepsTitle: 'Record the problem',
    steps: [
      'Open the diagnostic build. If macOS blocks it, choose Open Anyway in System Settings → Privacy & Security.',
      'Complete any permission requests, then reproduce the problem once.',
      'Open Atd Settings → General → Diagnostics and export the diagnostic log immediately.',
      'Send the ZIP file to the person helping you, along with what happened.',
    ],
    privacy:
      'The report stays on your Mac until you share it. It contains runtime states and, for a focus build, mouse and window events. It does not include chat contents, typed text, request bodies or screenshots.',
    returnNote: 'After collecting the report, quit this build and return to the regular version.',
    checksum: 'SHA-256',
  },
  zh: {
    label: 'Atd / 问题诊断',
    title: '诊断包下载',
    description: '按支持人员的指引，使用此版本记录问题。下载前，请确认要使用的版本号。',
    home: 'Atd 首页',
    skip: '跳到下载区域',
    stable: '下载正式版',
    choose: '选择 Mac 的芯片',
    chips: { arm64: 'Apple 芯片', x64: 'Intel 处理器' },
    download: (chip) => `下载 ${chip}版`,
    requires: (version) => `macOS ${version} 或更新版本`,
    version: '版本',
    recording: '记录内容',
    profiles: { runtime: '运行状态', focus: '运行状态与窗口焦点' },
    loading: '正在检查可用的诊断包…',
    unavailable: '暂时没有可下载的诊断包，准备好后支持人员会通知你。',
    error: '无法加载下载信息，请重试。',
    retry: '重试',
    noScript: '请启用 JavaScript，以获取当前诊断包的下载信息。',
    which: '在“关于本机”中，显示“芯片”即 Apple 芯片，显示“处理器”即 Intel。',
    before: '打开之前',
    environment: '请先退出正式版 Atd。诊断包会使用现有设置和会话，不会自动更新。',
    stepsTitle: '记录问题',
    steps: [
      '打开诊断包。如被 macOS 阻止，请在“系统设置 → 隐私与安全性”中选择“仍要打开”。',
      '完成出现的权限申请，然后复现一次问题。',
      '立即打开 Atd“设置 → 通用 → 诊断”，导出诊断日志。',
      '将 ZIP 文件发给协助你排查问题的人，并说明当时发生了什么。',
    ],
    privacy:
      '日志保存在本机，由你决定何时发送。内容包括运行状态；焦点诊断包还会记录鼠标与窗口事件，不含聊天内容、键入文字、请求正文或截图。',
    returnNote: '收集完成后，请退出诊断包，重新使用正式版。',
    checksum: 'SHA-256',
  },
} satisfies Localized<DebugCopy>;
