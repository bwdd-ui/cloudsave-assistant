const { parentPort } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');
parentPort.on('message', async ({ id, records }) => {
    const failedTargets = []; let firstError = null, archiveFailed = false;
    for (const [target, value] of records.sort((a,b) => Number(b[0].includes('resource-archive')) - Number(a[0].includes('resource-archive')))) {
      const archive = target.includes('resource-archive');
      // Keep an archive index behind its files, but allow independent settings,
      // caches and exports to persist even when one destination cannot be written.
      if (archiveFailed && value?.archivedResourceIndex && Object.keys(value.archivedResourceIndex).length) {
        failedTargets.push(target); continue;
      }
      try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = target + '.tmp';
      if (value?.__xlsxExport && /\.xlsx$/i.test(target)) {
        const tools = require('./scan-export');
        const table = value.table;
        await fs.writeFile(temp, table ? tools.buildTableXlsx(table.headers, value.rows, table.widths, table.name) : tools.buildXlsx(value.rows));
      } else await fs.writeFile(temp, JSON.stringify(value), 'utf8');
      await fs.rename(temp, target);
      } catch (error) {
        failedTargets.push(target); firstError ||= error.message || '后台文件写入失败';
        if (archive) archiveFailed = true;
      }
    }
    parentPort.postMessage({ id, ...(firstError ? { error: firstError, failedTargets } : {}) });
});
