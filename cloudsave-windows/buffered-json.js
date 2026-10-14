const { Worker } = require('worker_threads');
const path = require('path');
class BufferedJson {
  constructor(delay = 1200) {
    this.delay = delay; this.pending = new Map(); this.busy = null; this.waiters = []; this.revision = 0;
    this.closed = false; this.createWorker();
  }
  createWorker() {
    const worker = new Worker(path.join(__dirname, 'json-writer.js'));
    this.worker = worker; worker.unref();
    worker.on('message', result => {
      if (this.worker !== worker) return;
      if (!this.busy || result.id !== this.busy.id) return;
      if (result.error) {
        const failed = Array.isArray(result.failedTargets) ? new Set(result.failedTargets) : null;
        for (const [target, value] of this.busy.records) if ((!failed || failed.has(target)) && !this.pending.has(target)) this.pending.set(target, value);
        this.busy = null; this.lastError = new Error(result.error);
        for (const waiter of this.waiters.splice(0)) waiter.reject(this.lastError);
        this.worker.unref(); this.arm(); return;
      }
      this.busy = null; this.lastError = null;
      if (this.pending.size && this.waiters.length) this.send();
      else if (this.pending.size) this.arm();
      else { this.worker.unref(); for (const waiter of this.waiters.splice(0)) waiter.resolve(); }
    });
    worker.on('error', error => this.workerFailed(worker, error));
    worker.on('exit', code => {
      if (!this.closed && this.worker === worker) this.workerFailed(worker, new Error('后台数据写入线程已退出（' + code + '），待保存记录已保留'));
    });
  }
  workerFailed(worker, error) {
    if (this.worker !== worker || this.closed) return;
    this.worker = null; this.lastError = error;
    if (this.busy) for (const [target, value] of this.busy.records) if (!this.pending.has(target)) this.pending.set(target, value);
    this.busy = null;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.arm();
  }
  set(target, value) { if (this.closed) throw new Error('数据写入已关闭'); this.pending.set(target, value); this.arm(); }
  async xlsx(target, rows, table = null) {
    const exportValue = { __xlsxExport: true, rows, table }; this.set(target, exportValue);
    try { await this.flush(); }
    catch (error) {
      // An export reports failure to its caller. Do not keep retrying that
      // disposable workbook and block exit or a later export to another path.
      if (this.pending.get(target) === exportValue) this.pending.delete(target);
      if (!this.pending.size && !this.busy && this.timer) { clearTimeout(this.timer); this.timer = null; }
      throw error;
    }
  }
  peek(target) { return this.pending.has(target) ? this.pending.get(target) : this.busy?.records.find(row => row[0] === target)?.[1]; }
  dirty(target) { return this.pending.has(target) || Boolean(this.busy?.records.some(row => row[0] === target)); }
  arm() { if (!this.closed && !this.timer && !this.busy && this.pending.size) this.timer = setTimeout(() => { this.timer = null; this.send(); }, this.lastError ? Math.max(1000, this.delay) : this.delay); }
  send() {
    if (this.closed || this.busy || !this.pending.size) return;
    if (!this.worker) {
      try { this.createWorker(); }
      catch (error) { this.lastError = error; for (const waiter of this.waiters.splice(0)) waiter.reject(error); this.arm(); return; }
    }
    const records = [...this.pending]; this.pending.clear(); this.busy = { id: ++this.revision, records };
    this.worker.ref();
    try { this.worker.postMessage(this.busy); }
    catch (error) { for (const [target, value] of records) this.pending.set(target, value); this.busy = null; this.worker.unref(); for (const waiter of this.waiters.splice(0)) waiter.reject(error); this.lastError = error; }
  }
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.closed) return Promise.resolve();
    if (!this.pending.size && !this.busy) return Promise.resolve();
    const promise = new Promise((resolve, reject) => this.waiters.push({ resolve, reject })); this.send(); return promise;
  }
  async close() { await this.flush(); this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null; if (this.worker) await this.worker.terminate(); }
}
module.exports = { BufferedJson };
