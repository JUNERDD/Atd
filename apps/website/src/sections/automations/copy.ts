import type { Localized } from '../../i18n/lang';
import type { PresetId, RuleKind } from './presets';

interface AutomationsCopy {
  /** The plate's printed name, as the nav calls the section. */
  label: string;
  title: string;
  lede: string;
  presetsLegend: string;
  presets: Record<PresetId, string>;
  /** The legend before the rule readout: what kind of trigger it states. */
  ruleKinds: Record<RuleKind, string>;
  /** Monday first, as the grid's rows. */
  days: string[];
}

export const automationsCopy = {
  en: {
    label: 'Automations',
    title: 'Work that starts on its own.',
    lede: 'Run a prompt or a saved command on a schedule, or when a folder changes. It works unattended and tells you only what’s new.',
    presetsLegend: 'Examples',
    presets: {
      hourly: 'Every 2 hours',
      weekdays: 'Weekdays at 9:00',
      folder: 'When a folder changes',
    },
    ruleKinds: { cron: 'Cron', folder: 'Watching' },
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
  zh: {
    label: '自动化',
    title: '让工作自己开始。',
    lede: '按计划或在文件夹变化时，运行提示词或已保存的命令。它无人值守，只在有新结果时告诉你。',
    presetsLegend: '示例',
    presets: {
      hourly: '每 2 小时',
      weekdays: '工作日 9:00',
      folder: '文件夹变化时',
    },
    ruleKinds: { cron: 'Cron', folder: '监视' },
    days: ['一', '二', '三', '四', '五', '六', '日'],
  },
} satisfies Localized<AutomationsCopy>;
