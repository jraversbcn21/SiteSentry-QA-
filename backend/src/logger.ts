var LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as Record<string, number>;
var currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || LOG_LEVELS.info;

function formatMsg(level: string, msg: string): string {
  return '[' + new Date().toISOString() + '] [' + level.toUpperCase() + '] ' + msg;
}

export var logger = {
  debug: function(msg: string, ...args: any[]) {
    if (currentLevel <= LOG_LEVELS.debug) console.debug(formatMsg('debug', msg), ...args);
  },
  info: function(msg: string, ...args: any[]) {
    if (currentLevel <= LOG_LEVELS.info) console.log(formatMsg('info', msg), ...args);
  },
  warn: function(msg: string, ...args: any[]) {
    if (currentLevel <= LOG_LEVELS.warn) console.warn(formatMsg('warn', msg), ...args);
  },
  error: function(msg: string, ...args: any[]) {
    if (currentLevel <= LOG_LEVELS.error) console.error(formatMsg('error', msg), ...args);
  },
};
