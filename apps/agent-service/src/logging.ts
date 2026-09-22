/** Minimal JSON logger; never logs secret values (tokens, keys, answers). */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (message: string, fields?: Record<string, unknown>) => void;
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
  error: (message: string, fields?: Record<string, unknown>) => void;
}

const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(level: LogLevel = 'info'): Logger {
  const emit = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (order[entryLevel] < order[level]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...(fields ?? {}),
    });
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
