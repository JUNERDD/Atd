import { BoundedLogRing } from './diagnostics/log-ring.js';

/** Minimal JSON logger; never logs secret values (tokens, keys, answers). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let serviceLogRing = new BoundedLogRing();

/** Returns the shared in-memory log ring populated by service loggers. */
export function getServiceLogRing(): BoundedLogRing {
  return serviceLogRing;
}

/** Replaces the shared service log ring; intended for isolated unit tests. */
export function resetServiceLogRing(): BoundedLogRing {
  serviceLogRing = new BoundedLogRing();
  return serviceLogRing;
}

export function createLogger(
  level: LogLevel = 'info',
  ring: BoundedLogRing | null = serviceLogRing,
): Logger {
  const emit = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (order[entryLevel] < order[level]) return;
    const ts = new Date().toISOString();
    const line = JSON.stringify({
      ts,
      level: entryLevel,
      msg: message,
      ...fields,
    });
    ring?.push(line, { ts, level: entryLevel, trustedJson: true });
    if (entryLevel === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
