const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
class ResourceArchive {
  constructor(root, store, limit = 5000) { this.root = root; this.store = store; this.limit = limit; this.cache = new Map(); }
  file(key) { return path.join(this.root, crypto.createHash('sha256').update(key).digest('hex') + '.json'); }
  get(database, key) {
    if (database.resources[key]) return database.resources[key];
    if (!database.archivedResourceIndex?.[key]) return undefined;
    let value = this.cache.get(key);
    if (!value) {
      const file = this.file(key); const saved = this.store.peek(file) || JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved.identity !== key || !saved.resource) throw new Error('本地归档资源身份不符，未覆盖旧记录');
      value = saved.resource;
    }
    this.cache.delete(key); this.cache.set(key, value);
    while (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
  save(database, key, resource) {
    if (database.archivedResourceIndex?.[key] && !database.resources[key]) {
      database.archivedResourceIndex[key].status = resource.status; database.archivedResourceIndex[key].updatedAt = resource.updatedAt;
      database.archivedResourceIndex[key].associations = resource.associations;
      this.store.set(this.file(key), { identity: key, resource });
      // A replacement snapshot must not leave the prior object in the read cache.
      this.cache.delete(key);
    }
  }
  prune(database) {
    const entries = Object.entries(database.resources);
    database.archivedResourceIndex ||= {};
    for (const [key] of entries) delete database.archivedResourceIndex[key];
    let excess = entries.length - this.limit;
    if (excess <= 0) return;
    const terminal = entries.filter(([, row]) => ['success','duplicate','placement_failed'].includes(row.status)).sort((a,b) => String(a[1].updatedAt || '').localeCompare(String(b[1].updatedAt || '')));
    for (const [key, resource] of terminal) {
      if (excess-- <= 0) break;
      this.store.set(this.file(key), { identity: key, resource });
      const { movieInfo, seedInfo, torrentInfo, exportRecord, episodeFiles, ...index } = resource;
      database.archivedResourceIndex[key] = { ...index, ...(episodeFiles ? { episodeFiles: { keys: episodeFiles.keys, sizes: episodeFiles.sizes, missingKeys: episodeFiles.missingKeys, partial: episodeFiles.partial, hasFileList: episodeFiles.hasFileList } } : {}) };
      delete database.resources[key]; this.cache.delete(key);
    }
  }
  entries(database) { return [...Object.entries(database.archivedResourceIndex || {}), ...Object.entries(database.resources)]; }
}
module.exports = { ResourceArchive };
