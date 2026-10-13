const assert = require('node:assert/strict'), { Qmp4Provider } = require('../qmp4-provider');
(async () => {
  let reads = 0; const controller = new AbortController();
  const provider = new Qmp4Provider({ fetchHtml: async () => { reads++; return ''; }, parseHtml: async () => ({}) });
  provider.nextRequest = Date.now() + 120;
  const pending = provider.read('/mv/1.html', 'detail', true, { signal: controller.signal });
  setTimeout(() => controller.abort(Error('已停止扫描')), 5);
  await assert.rejects(pending, /已停止/);
  await new Promise(resolve => setTimeout(resolve, 140)); assert.equal(reads, 0);
  await assert.rejects(provider.read('/mv/2.html', 'detail', true, { signal: controller.signal }));
  provider.close();
  const original = global.fetch, active = new AbortController(); let requestSignal;
  try {
    global.fetch = (_url, options) => new Promise((_, reject) => { requestSignal = options.signal; options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); });
    const live = new Qmp4Provider({ parseHtml: async () => ({}) });
    const job = live.read('/mv/3.html', 'detail', true, { signal: active.signal });
    while (!requestSignal) await new Promise(resolve => setImmediate(resolve));
    active.abort(Error('已停止扫描')); await assert.rejects(job, /已停止/); assert(requestSignal.aborted); live.close();
  } finally { global.fetch = original; }
  console.log('PASS 七味间隔等待立即取消、不发出已取消请求、在途网络请求随停止信号终止');
})().catch(error => { console.error(error); process.exitCode = 1; });
