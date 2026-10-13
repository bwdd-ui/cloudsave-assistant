const {app} = require('electron');
require('./main.js');
// Container shutdown must go through the application's existing flush handler.
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => app.quit());
if (process.env.CLOUDSAVE_SMOKE_TEST === '1') require('./smoke.cjs');
