const levels = { info: '\x1b[36m[INFO]\x1b[0m', warn: '\x1b[33m[WARN]\x1b[0m', error: '\x1b[31m[ERROR]\x1b[0m', success: '\x1b[32m[OK]\x1b[0m' };
const ts = () => new Date().toTimeString().slice(0, 8);
export const logger = {
  info: (msg) => console.log(`${ts()} ${levels.info} ${msg}`),
  warn: (msg) => console.log(`${ts()} ${levels.warn} ${msg}`),
  error: (msg, err) => { console.error(`${ts()} ${levels.error} ${msg}`); if (err) console.error(err); },
  success: (msg) => console.log(`${ts()} ${levels.success} ${msg}`),
};
