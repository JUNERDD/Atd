/** The example triggers the week grid can show. */
export const PRESET_IDS = ['hourly', 'weekdays', 'monday', 'folder'] as const;

export type PresetId = (typeof PRESET_IDS)[number];

export type RuleKind = 'cron' | 'folder';

/** Each preset's rule as an automation states it: a cron expression, or the folder it watches. */
export const RULES: Record<PresetId, { kind: RuleKind; text: string }> = {
  hourly: { kind: 'cron', text: '0 */2 * * *' },
  weekdays: { kind: 'cron', text: '0 9 * * 1-5' },
  monday: { kind: 'cron', text: '30 8 * * 1' },
  folder: { kind: 'folder', text: '~/Downloads' },
};

export const DAYS = 7;
export const HOURS = 24;

/**
 * Hours in which files happened to land in the watched folder (`day-hour`, Monday = 0): a folder
 * trigger follows events, so its week has no pattern.
 */
const FOLDER_EVENTS = new Set([
  '0-10',
  '0-15',
  '1-9',
  '1-13',
  '1-17',
  '2-11',
  '3-10',
  '3-16',
  '3-18',
  '4-9',
  '4-14',
  '5-12',
  '6-19',
]);

/** Whether a preset runs in a given hour of the week; `day` is 0 for Monday through 6 for Sunday. */
export function runsAt(preset: PresetId, day: number, hour: number): boolean {
  switch (preset) {
    case 'hourly':
      return hour % 2 === 0;
    case 'weekdays':
      return day < 5 && hour === 9;
    case 'monday':
      return day === 0 && hour === 8;
    case 'folder':
      return FOLDER_EVENTS.has(`${day}-${hour}`);
  }
}
