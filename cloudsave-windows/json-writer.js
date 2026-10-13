const { parentPort } = require('worker_threads');
const fs = require('fs/promises');
const path = require('path');
parentPort.on('message', async ({ id, records }) => {
  try {
    for (const [target, value] of records.sort((a,b) => Number(b[0].includes('resource-archive')) - Number(a[0].includes('resource-archive')))) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const temp = target + '.tmp';
      if (value?.__xlsxExport && /\.xlsx$/i.test(target)) {
        const tools = require('./scan-export');
        const table = value.table;
        await fs.writeFile(temp, table ? tools.buildTableXlsx(table.headers, value.rows, table.widths, table.name) : tools.buildXlsx(value.rows));
      } else await fs.writeFile(temp, JSON.stringify(value), 'utf8');
      await fs.rename(temp, target);
    }
    parentPort.postMessage({ id });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
