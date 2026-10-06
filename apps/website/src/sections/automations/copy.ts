import type { Localized } from '../../i18n/lang';
import type { PresetId, RuleKind } from './presets';

interface AutomationsCopy {
  kicker: string;
  /** Automations are unreleased: the heading carries this badge. */
  badge: string;
  /** Read between the badge and the heading text, which are visually on separate lines. */
  badgeJoin: string;
  title: string;
  lede: string;
  presetsLegend: string;
  presets: Record<PresetId, { label: string; description: string }>;
  ruleKinds: Record<RuleKind, string>;
  /** Monday first, as the grid's rows. */
  days: string[];
  triggersLabel: string;
  triggers: string[];
  promisesTitle: string;
  promises: { title: string; body: string }[];
}

export const automationsCopy = {
  en: {
    kicker: 'Automations',
    badge: 'Coming in 0.7',
    badgeJoin: ': ',
    title: 'Work that starts on its own.',
    lede: 'Run a prompt or a saved command on a schedule, when files land in a folder you granted, or after another automation finishes.',
    presetsLegend: 'Examples',
    presets: {
      hourly: { label: 'Every 2 hours', description: 'On the hour, every two hours, every day.' },
      weekdays: { label: 'Weekdays at 9:00', description: 'Monday to Friday at 9:00.' },
      monday: { label: 'Mondays at 8:30', description: 'Every Monday at 8:30.' },
      folder: {
        label: 'When a folder changes',
        description: 'Whenever files are added to the folder or change in it.',
      },
    },
    ruleKinds: { cron: 'Cron', folder: 'Folder' },
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    triggersLabel: 'Triggers',
    triggers: [
      'Once',
      'Every N minutes',
      'Every N hours',
      'Daily',
      'Weekly',
      'Monthly',
      'Cron in a chosen time zone',
      'Folder changes',
      'After another automation',
    ],
    promisesTitle: 'Built to run while you are away.',
    promises: [
      {
        title: 'Never waits on you',
        body: 'An unattended run declines anything that would need approval instead of stopping to ask.',
      },
      {
        title: 'Results come to you',
        body: 'They arrive as macOS notifications and in the run history.',
      },
      {
        title: 'Quiet when nothing is new',
        body: 'A run that finds nothing new sends no notification.',
      },
      {
        title: 'Failures always speak up',
        body: 'A failed run always notifies you, even when the others stay quiet.',
      },
      {
        title: 'Catches up once',
        body: 'After a missed schedule, the automation runs once to catch up, not once for every miss.',
      },
      {
        title: 'Stops after three failures',
        body: 'Three failures in a row turn the automation off.',
      },
      {
        title: 'You confirm every change',
        body: 'The agent can propose an automation in a conversation; nothing changes until you confirm.',
      },
    ],
  },
  zh: {
    kicker: '自动化',
    badge: '0.7 即将推出',
    badgeJoin: '：',
    title: '让工作自己开始。',
    lede: '按计划、在你授权的文件夹出现新文件或文件变化时，或在另一个自动化完成后，运行一段提示词或一条已保存的命令。',
    presetsLegend: '示例',
    presets: {
      hourly: { label: '每 2 小时', description: '每天整点运行，每两小时一次。' },
      weekdays: { label: '工作日 9:00', description: '周一至周五的 9:00。' },
      monday: { label: '每周一 8:30', description: '每周一的 8:30。' },
      folder: { label: '文件夹变化时', description: '文件夹中有文件新增或变化时运行。' },
    },
    ruleKinds: { cron: 'Cron', folder: '文件夹' },
    days: ['一', '二', '三', '四', '五', '六', '日'],
    triggersLabel: '触发方式',
    triggers: [
      '单次',
      '每 N 分钟',
      '每 N 小时',
      '每天',
      '每周',
      '每月',
      '指定时区的 Cron 表达式',
      '文件夹变化',
      '另一个自动化完成后',
    ],
    promisesTitle: '为无人值守而设计。',
    promises: [
      {
        title: '不会卡住等你',
        body: '无人值守的运行遇到需要批准的操作时会直接拒绝，而不是停下来等你。',
      },
      {
        title: '结果主动送达',
        body: '结果会以 macOS 通知送达，并记录在运行历史中。',
      },
      {
        title: '没有新内容就不打扰',
        body: '没有发现新内容的运行不会发送通知。',
      },
      {
        title: '失败一定会通知',
        body: '运行失败时一定会通知你，即使其他运行都保持安静。',
      },
      {
        title: '错过只补一次',
        body: '错过计划时间后，自动化只补跑一次，不会每错过一次就补一次。',
      },
      {
        title: '连续失败三次即关闭',
        body: '连续三次失败后，自动化会自动关闭。',
      },
      {
        title: '每项改动都由你确认',
        body: '智能体可以在对话中提议自动化，所有改动都要等你确认。',
      },
    ],
  },
} satisfies Localized<AutomationsCopy>;
