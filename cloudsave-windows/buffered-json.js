const { Worker } = require('worker_threads');
const path = require('path');
class BufferedJson {
  constructor(delay = 1200) {
    this.delay = delay; this.pending = new Map(); this.busy = null; this.waiters = []; this.revision = 0;
    this.worker = new Worker(path.join(__dirname, 'json-writer.js'));
    this.worker.unref();
    this.worker.on('message', result => {
      if (!this.busy || result.id !== this.busy.id) return;
      if (result.error) {
        for (const [target, value] of this.busy.records) if (!this.pending.has(target)) this.pending.set(target, value);
        this.busy = null; this.lastError = new Error(result.error);
        for (const waiter of this.waiters.splice(0)) waiter.reject(this.lastError);
        this.arm(); return;
      }
      this.busy = null; this.lastError = null;
      if (this.pending.size && this.waiters.length) this.send();
      else if (this.pending.size) this.arm();
      else { this.worker.unref(); for (const waiter of this.waiters.splice(0)) waiter.resolve(); }
    });
    this.worker.on('error', error => {
      this.lastError = error;
      if (this.busy) for (const [target, value] of this.busy.records) if (!this.pending.has(target)) this.pending.set(target, value);
      this.busy = null; for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    });
  }
  set(target, value) { this.pending.set(target, value); this.arm(); }
  async xlsx(target, rows, table = null) { this.set(target, { __xlsxExport: true, rows, table }); await this.flush(); }
  peek(target) { return this.pending.get(target) ?? this.busy?.records.find(row => row[0] === target)?.[1]; }
  dirty(target) { return this.pending.has(target) || Boolean(this.busy?.records.some(row => row[0] === target)); }
  arm() { if (!this.timer && !this.busy && this.pending.size) this.timer = setTimeout(() => { this.timer = null; this.send(); }, this.delay); }
  send() {
    if (this.busy || !this.pending.size) return;
    const records = [...this.pending]; this.pending.clear(); this.busy = { id: ++this.revision, records };
    this.worker.ref();
    try { this.worker.postMessage(this.busy); }
    catch (error) { for (const [target, value] of records) this.pending.set(target, value); this.busy = null; for (const waiter of this.waiters.splice(0)) waiter.reject(error); this.lastError = error; }
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.lastError && !this.busy) return Promise.reject(this.lastError);
    if (!this.pending.size && !this.busy) return Promise.resolve();
    const promise = new Promise((resolve, reject) => this.waiters.push({ resolve, reject })); this.send(); return promise;
  }
  async close() { await this.flush(); await this.worker.terminate(); }
}
module.exports = { BufferedJson };
