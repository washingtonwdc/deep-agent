/*
 * File: logger.ts
 * Project: deepsproxy
 * Structured logger respecting LOG_LEVEL from .env
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 } as const;
type Level = keyof typeof LEVELS;

const configured = (process.env.LOG_LEVEL?.toLowerCase() ?? 'info') as Level;
const activeLevel: number = LEVELS[configured] ?? LEVELS.info;

function fmt(level: string, msg: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  const extra = meta !== undefined ? ' ' + JSON.stringify(meta) : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${extra}`;
}

export const logger = {
  debug(msg: string, meta?: unknown) {
    if (activeLevel <= LEVELS.debug) console.debug(fmt('debug', msg, meta));
  },
  info(msg: string, meta?: unknown) {
    if (activeLevel <= LEVELS.info) console.info(fmt('info', msg, meta));
  },
  warn(msg: string, meta?: unknown) {
    if (activeLevel <= LEVELS.warn) console.warn(fmt('warn', msg, meta));
  },
  error(msg: string, meta?: unknown) {
    if (activeLevel <= LEVELS.error) console.error(fmt('error', msg, meta));
  },
};
