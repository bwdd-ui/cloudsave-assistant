const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PREFIX = 'portable:v1:';
function createPortableStorage(app, safeStorage, root) {
  const legacy = app.getPath('userData');
  const data = path.join(root, 'Data');
  fs.mkdirSync(data, { recursive: true });
  if (!fs.existsSync(path.join(data, 'config.json')) && fs.existsSync(path.join(legacy, 'config.json')) && path.resolve(data) !== path.resolve(legacy)) {
    const disposable = new Set(['Cache', 'Code Cache', 'GPUCache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'ShaderCache', 'GPUPersistentCache']);
    fs.cpSync(legacy, data, { recursive: true, filter: source => !path.relative(legacy, source).split(path.sep).some(part => disposable.has(part) || part.endsWith('.tmp')) });
  }
  app.setPath('userData', data);
  app.setPath('sessionData', data);
  const keyPath = path.join(data, 'portable-key.bin');
  let key;
  function getKey() {
    if (!key) {
      if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { flag: 'wx' });
      key = fs.readFileSync(keyPath);
      if (key.length !== 32) throw new Error('便携登录密钥无效，请保留Data文件夹并恢复备份');
    }
    return key;
  }
  function encrypt(value) {
    if (!value) return '';
    const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', getKey(), nonce);
    const bytes = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return PREFIX + [nonce, cipher.getAuthTag(), bytes].map(item => item.toString('base64')).join(':');
  }
  function decrypt(value) {
    if (!value) return '';
    if (String(value).startsWith(PREFIX)) {
      const [nonce, tag, bytes] = String(value).slice(PREFIX.length).split(':').map(part => Buffer.from(part, 'base64'));
      const cipher = crypto.createDecipheriv('aes-256-gcm', getKey(), nonce); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(bytes), cipher.final()]).toString('utf8');
    }
    if (/^(?:UID=|magnet:|eyJ[^:]+\.)/.test(String(value))) return String(value);
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : String(value);
  }
  function migrate(config) {
    let changed = false, failed = 0;
    const fields = [[config, 'cookie'], [config.siteSession, 'token'], [config.siteSession, 'cookie'], [config.guanyingSession, 'cookies']];
    const credentials = config.credentials || {};
    for (const saved of credentials.account || credentials.password ? [credentials] : Object.values(credentials)) fields.push([saved, 'account'], [saved, 'password']);
    for (const [object, name] of fields) {
      if (!object?.[name] || String(object[name]).startsWith(PREFIX)) continue;
      try { const plain = decrypt(object[name]); if (!plain) { failed++; continue; } object[name] = encrypt(plain); changed = true; }
      catch (_) { failed++; }
    }
    return { changed, failed };
  }
  return { data, encrypt, decrypt, migrate };
}
module.exports = { createPortableStorage };
