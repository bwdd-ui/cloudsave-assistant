const assert = require('node:assert/strict');
const { GuanyingSession } = require('../guanying-session');
(async () => {
  let stored = { storage: '{}', userAgent: 'Old UA' }, destroyed = false, duringStorage = false, duringAgent = false;
  let flushed = 0, saves = 0, touchedDestroyed = 0;
  const partition = {
    getUserAgent: () => 'Stable Partition UA',
    cookies: { get: async () => { if (!duringStorage && !duringAgent) destroyed = true; return [{ name: 'session', value: 'synthetic-renewed', domain: 'www.xn--wcv59z.com' }]; }, flushStore: async () => { flushed++; } },
    flushStorageData: async () => { flushed++; }
  };
  const win = { isDestroyed: () => destroyed, webContents: {
    getURL: () => 'https://www.xn--wcv59z.com/mv',
    executeJavaScript: async () => { destroyed = true; return '{"updated":"synthetic-storage"}'; },
    getUserAgent: () => { if (destroyed || duringAgent) { touchedDestroyed++; throw Error('Object has been destroyed'); } return 'Window UA'; }
  } };
  const session = new GuanyingSession({ partition, origin: 'https://www.xn--wcv59z.com', read: () => stored, save: value => { saves++; stored = value; }, encrypt: value => value, decrypt: value => value });
  await session.capture(win);
  assert.equal(touchedDestroyed, 0); assert.equal(stored.userAgent, 'Stable Partition UA');
  assert.equal(JSON.parse(stored.cookies)[0].value, 'synthetic-renewed'); assert.equal(flushed, 2);
  destroyed = false; duringStorage = true;
  await session.capture(win); assert.equal(JSON.parse(stored.storage).updated, 'synthetic-storage');
  assert.equal(touchedDestroyed, 0); assert.equal(flushed, 4);
  destroyed = false; duringStorage = false; duringAgent = true;
  // A window can become unusable even between isDestroyed() and reading UA.
  win.webContents.executeJavaScript = async () => '{}';
  await session.capture(win); assert.equal(touchedDestroyed, 1); assert.equal(flushed, 6);
  await session.close(); assert(session.closed); assert.equal(flushed, 8); assert(saves >= 1);
  console.log('PASS closed login windows retain renewed cookies/storage and partition identity, including destruction during capture');
})().catch(error => { console.error(error); process.exitCode = 1; });
