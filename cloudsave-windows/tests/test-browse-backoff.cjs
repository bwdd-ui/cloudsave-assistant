const assert = require('node:assert/strict'), { BrowseCache } = require('../browse-cache');
(async () => {
  let clock = 1000000, calls = 0;
  const rows = new Map(), cache = { get: key => rows.get(key), set: (key, value) => rows.set(key, value) };
  const reader = new BrowseCache({ cache, now: () => clock, delay: 1 });
  const key = reader.key('bt', [1]); rows.set(key, { time: clock - 200000, value: { items: [{ id: 'saved' }] } });
  const fail = async () => { calls++; throw Error('offline'); };
  await reader.get('bt', [1], fail); await reader.pending.get(key);
  assert.equal(calls, 1);
  for (let i = 0; i < 10; i++) assert.equal((await reader.get('bt', [1], fail)).items[0].id, 'saved');
  assert.equal(calls, 1); clock += 30000;
  await reader.get('bt', [1], fail); await reader.pending.get(key); assert.equal(calls, 2);
  assert.equal(reader.failures.get(key).retryAt, clock + 60000);
  clock += 60000;
  await reader.get('bt', [1], async () => ({ items: [{ id: 'new' }] })); await reader.pending.get(key);
  assert(!reader.failures.has(key)); assert.equal((await reader.get('bt', [1], fail)).items[0].id, 'new');
  // Close clears a long delayed refresh immediately and starts no request.
  reader.delay = 60000; clock += 200000;
  await reader.get('bt', [1], fail); const pending = reader.pending.get(key);
  reader.close(); await pending; assert.equal(reader.timers.size, 0); assert.equal(calls, 2);
  console.log('PASS cached failure backoff, no request storm, successful recovery and immediate deferred shutdown');
})().catch(error => { console.error(error); process.exitCode = 1; });
