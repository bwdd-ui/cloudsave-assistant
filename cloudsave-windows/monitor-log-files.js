const path = require('path');
// monitor-YYYY-MM-DD.jsonl is appended to by every monitor action and nothing ever deleted a
// day file, so an install left running for months filled the disk with stale logs.
const PREFIX = 'monitor-';
const SUFFIX = '.jsonl';
const DAY_MS = 86400000;
const dayNumber = iso => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

function isDayFile(name) {
  return new RegExp(`^${PREFIX}\\d{4}-\\d{2}-\\d{2}\\${SUFFIX}$`).test(name);
}

// Pure half: which day files sit before the retention window.
function staleFiles(names, today, keepDays) {
  const cutoff = dayNumber(today) - keepDays;
  return names.filter(name => isDayFile(name) && dayNumber(name.slice(PREFIX.length, name.length - SUFFIX.length)) < cutoff);
}

let lastPruneDay = '';
function retention(fs, currentFile, keepDays = 14) {
  const dir = path.dirname(currentFile);
  const day = path.basename(currentFile, SUFFIX).slice(PREFIX.length);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day === lastPruneDay) return 0;
  lastPruneDay = day;
  let names;
  try { names = fs.readdirSync(dir); } catch { return 0; /* housekeeping never fails a log entry */ }
  let deleted = 0;
  for (const name of staleFiles(names, day, keepDays)) {
    try { fs.unlinkSync(path.join(dir, name)); deleted++; } catch { /* a locked file is retried at the next day boundary */ }
  }
  return deleted;
}

module.exports = { PREFIX, SUFFIX, isDayFile, staleFiles, retention, resetRetentionDay: () => { lastPruneDay = ''; } };
