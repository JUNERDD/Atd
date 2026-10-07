import { Type, type Static } from 'typebox';

/**
 * How recently the person used the Mac, as the shell sees it. The service keeps only the latest
 * report in memory, to decide whether idle triggers (`AutomationTrigger` `idle`) may fire; a report
 * older than `SYSTEM_ACTIVITY_STALE_SECONDS` counts as unknown, which is never idle, so a shell
 * that stops reporting cannot leave the Mac looking idle.
 */

/** How often the shell reports while it is connected to the service. */
export const SYSTEM_ACTIVITY_REPORT_SECONDS = 60;
/** A report older than this no longer says anything about the person. */
export const SYSTEM_ACTIVITY_STALE_SECONDS = 180;

/** POST `/v1/system-activity` (shell only); answered with 204. */
export const SystemActivityReportSchema = Type.Object(
  {
    /** Seconds since the last keyboard, mouse or trackpad input in the login session. */
    idleSeconds: Type.Number({ minimum: 0, maximum: 31_536_000 }),
  },
  { additionalProperties: false },
);
export type SystemActivityReport = Static<typeof SystemActivityReportSchema>;
