const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { BufferedJson } = require('../buffered-json');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudsave-recovery-'));
  const store = new BufferedJson(60000), file = path.join(root, 'history.json');
  try {
    // A terminated worker must reject the active flush, retaining the newest
    // version for a new worker. It must never leave shutdown waiting forever.
    store.set(file, { value: 1 });
    const worker = store.worker;
    await worker.terminate();
    assert.equal(store.worker, null);
    store.set(file, { value: 2 });
    await store.flush();
    assert.equal(JSON.parse(fs.readFileSync(file)).value, 2);
    assert.notEqual(store.worker, worker);
    const blocked = path.join(root, 'blocked'); fs.writeFileSync(blocked, 'not a directory');
    const target = path.join(blocked, 'config.json');
    store.set(target, { value: 'retry' });
    await assert.rejects(store.flush());
    assert(store.dirty(target));
    fs.unlinkSync(blocked); fs.mkdirSync(blocked);
    // Explicit flush retries immediately after the disk problem is corrected.
    await store.flush();
    assert.equal(JSON.parse(fs.readFileSync(target)).value, 'retry');
    store.set(path.join(root, 'nullable.json'), null); await store.flush();
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'nullable.json'))), null);
    await store.close(); assert.throws(() => store.set(file, {}), /关闭/);
    console.log('PASS writer exit recovery, retained pending data, repaired disk retry, null JSON and closed-state guard');
  } finally { if (!store.closed) await store.worker?.terminate(); if (store.timer) clearTimeout(store.timer); fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
