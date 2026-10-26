// 115 接口层。传输由调用方注入：桌面端走 Electron 的 fetch，手机端走原生 HTTP 桥。
// 放在这里的原因是这些判定会在 115 改版时一起改，两边各存一份必然漂移。
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

// 115 会把未登录的长整型 ID 直接写成裸数字，JSON.parse 会静默丢精度，所以先把超范围的整数转成字符串。
function parse115Json(source) {
  let safe = ''; let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const start = index++;
      while (index < source.length) { if (source[index] === '\\') { index += 2; continue; } if (source[index++] === '"') break; }
      safe += source.slice(start, index); continue;
    }
    if (char === '-' || /[0-9]/.test(char)) {
      const token = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)[0];
      safe += /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token;
      index += token.length; continue;
    }
    safe += char; index++;
  }
  return JSON.parse(safe);
}

function check115(result) {
  const ok = result && (result.state === true || result.success === true);
  if (ok) return;
  const code = Number(result?.errno ?? result?.errNo ?? result?.code ?? -1);
  const message = String(result?.error || result?.error_msg || result?.msg || result?.message || '115 请求失败');
  if ([99, 401, 990001].includes(code) || message.includes('登录')) throw new Error('115 登录已失效，请重新登录');
  throw new Error(message);
}

function normalizeCookie(raw) {
  let source = String(raw || '').trim().replace(/^cookie\s*:\s*/i, '');
  if (!source) throw new Error('请粘贴 Cookie');
  const required = new Set(['UID', 'CID', 'SEID']);
  const values = new Map();
  for (const part of source.split(/[;,\r\n]+/)) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const originalKey = part.slice(0, separator).trim();
    if (!/^[A-Za-z0-9_.-]+$/.test(originalKey)) continue;
    const upperKey = originalKey.toUpperCase();
    const encoded = part.slice(separator + 1).trim();
    let value = encoded;
    try { value = decodeURIComponent(encoded.replace(/\+/g, '%2B')); } catch (_) {}
    value = value.trim();
    if (value) values.set(upperKey, { key: required.has(upperKey) ? upperKey : originalKey, value });
  }
  for (const key of required) if (!values.get(key)?.value) throw new Error(`Cookie 格式不正确，缺少 ${key}，请复制完整 Cookie`);
  return [...values.values()].map(item => `${item.key}=${item.value}`).join('; ');
}

// fetch 由调用方给，超时也归调用方管：手机端是原生连接池，桌面端是 Electron 的 net 栈，节律不一样。
async function requestJson(fetch, url, options = {}, cookie = '') {
  const requested = new URL(url);
  const headers = { 'User-Agent': USER_AGENT, ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  let response;
  try { response = await fetch(url, { ...options, headers, redirect: 'manual' }); }
  catch (error) { throw Object.assign(new Error(`${requested.hostname}${requested.pathname}：${error.message}`), { transportError: true }); }
  if (response.status >= 300 && response.status < 400) throw new Error('服务器要求重新登录或发生了跳转');
  if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
  const text = await response.text();
  try { return /(^|\.)115\.com$/.test(requested.hostname) ? parse115Json(text) : JSON.parse(text); } catch { throw new Error('服务器返回了无法识别的响应'); }
}

function getAccount(request, cookie) {
  return request('https://my.115.com/?ct=ajax&ac=nav', {}, cookie).then(result => {
    check115(result);
    const data = result.data || {};
    const user = data.user_info || data.user || data;
    const uid = String(user.user_id || user.uid || user.id || (cookie.match(/(?:^|;\s*)UID=(\d+)/) || [])[1] || '');
    if (!uid) throw new Error('Cookie 中没有有效的 UID，请重新登录 115');
    return { uid, nickname: String(user.user_name || user.nick_name || user.nickname || user.uname || '115用户') };
  });
}

function getFolders(request, cookie, cid = '0') {
  const params = new URLSearchParams({ cid, aid: '1', o: 'file_name', asc: '1', show_dir: '1', nf: '1', offset: '0', limit: '1000' });
  return request(`https://webapi.115.com/files?${params}`, {}, cookie).then(result => {
    check115(result);
    const rows = Array.isArray(result.data) ? result.data : (result.data?.list || result.list || []);
    return rows.map(item => {
      const hasDirFlag = item.is_dir !== undefined;
      const isDir = hasDirFlag ? Number(item.is_dir) === 1 : (!item.fid || String(item.fid) === '0') && item.cid;
      // 115 返回中没有 is_dir 时，cid 是文件夹自身 ID，fid 只是文件条目字段。
      const returnedCid = String(item.cid ?? '');
      const folderId = returnedCid && returnedCid !== String(cid) && returnedCid !== '0' ? returnedCid : (item.file_id || item.fid);
      return isDir ? { cid: String(folderId), name: String(item.n || item.name || item.file_name || ''), parent: cid } : null;
    }).filter(item => item && item.name && /^\d+$/.test(item.cid) && item.cid !== '0');
  });
}

async function validateSaveFolder(request, cookie, folder, uid) {
  if (folder.uid && String(folder.uid) !== String(uid)) throw new Error('115账户与保存目录不匹配，请重新选择目录');
  if (!/^\d+$/.test(String(folder.cid ?? ''))) throw new Error('保存目录ID无效，请重新选择目录');
  if (String(folder.cid) === '0') return { cid: '0', name: '根目录', uid: String(uid) };
  const params = new URLSearchParams({ cid: String(folder.cid), aid: '1', offset: '0', limit: '1', show_dir: '1' });
  const result = await request(`https://webapi.115.com/files?${params}`, {}, cookie); check115(result);
  const path = Array.isArray(result.path) ? result.path : result.data?.path;
  const last = Array.isArray(path) ? path[path.length - 1] : null;
  const actualCid = last ? String(last.cid ?? last.file_id ?? last.id ?? '') : String(result.cid ?? result.data?.cid ?? '');
  if (actualCid !== String(folder.cid)) throw new Error('115未确认所选目录，目录可能已删除或ID错误，请重新读取并选择文件夹');
  return { cid: actualCid, name: String(last?.name || last?.n || folder.name || actualCid), uid: String(uid) };
}

module.exports = { USER_AGENT, parse115Json, check115, normalizeCookie, requestJson, getAccount, getFolders, validateSaveFolder };
