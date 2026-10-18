const assert = require('node:assert/strict');
const { Qmp4Provider, ORIGIN } = require('../qmp4-provider');

(async () => {
  const originalFetch = global.fetch;
  const cached = [];
  const provider = new Qmp4Provider({ diskCache: { set: (...args) => cached.push(args) } });
  try {
    global.fetch = async url => ({ ok: false, status: 403, url: String(url), text: async () => '<html><title>Security check</title>Verify you are human</html>' });
    const search = '/vs/-------------.html?wd=影片&page=1';
    await assert.rejects(provider.read(search, 'catalog', true), error => error.loginRequired && /需要网站验证/.test(error.message));
    assert.equal(provider.verificationUrl, new URL(search, ORIGIN).href);
    assert.equal(cached.length, 0, 'challenge responses must never be cached as empty search results');

    provider.nextRequest = 0;
    global.fetch = async url => ({ ok: false, status: 403, url: String(url), text: async () => '<html><title>Forbidden</title>Request denied</html>' });
    await assert.rejects(provider.read('/mv/123.html', 'detail', true), /七味读取失败（403）/);
    assert.equal(cached.length, 0);
  } finally {
    provider.close();
    global.fetch = originalFetch;
  }
  console.log('PASS 七味搜索遇到403人机验证时提示用户打开验证，并保留原搜索地址重试；普通403仍按HTTP错误处理且挑战页不进缓存');
})().catch(error => { console.error(error); process.exitCode = 1; });
