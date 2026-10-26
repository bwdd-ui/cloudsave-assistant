// 没有手机也能把 apk 里那份页面跑起来：本地静态服务 + 一个和原生桥同契约的假 CsNative。
//
// 为什么需要它：这台机器没有 Android 设备也没有模拟器，而 apk 里的页面在普通浏览器里打不开——
// 第三方站点不给本地页面返回 CORS 头，浏览器内核会先把请求拦掉，而那正是原生桥存在的理由。
// 这里把「拦请求」这一层换成同源代理，其余部分（index.html / host.js / app.js / 打包产物）
// 一行不改地原样加载，于是界面与站点解析都能在真 Chromium 里验证。
//
//   node android-app/tools/preview.cjs [--port 8801] [--data 文件]
//
// 只用于开发：这个文件不在 assets/ 里，构建脚本不会把它打进 apk。
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');

const WWW = path.resolve(__dirname, '..', 'assets', 'www');
const MAX_BODY_BYTES = 32 * 1024 * 1024;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(argument('--port', 8801));
const dataFile = path.resolve(argument('--data', path.join(require('os').tmpdir(), 'cloudsave-phone-preview.json')));

// 存储分两间：secrets 对应 AndroidKeyStore，plain 对应 SharedPreferences。
function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return { plain: parsed.plain || {}, secrets: parsed.secrets || {} };
  } catch (error) {
    return { plain: {}, secrets: {} };
  }
}
const store = loadStore();
function saveStore() {
  try { fs.writeFileSync(dataFile, JSON.stringify(store)); } catch (error) { console.error('存储写入失败：' + error.message); }
}

const BRIDGE = `
(function () {
  'use strict';
  // 原生桥的 http 是同步的（JavaBridge 线程上排队），这里用同步 XHR 保持同样的时序。
  function call(method, route, payload) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, route, false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(payload == null ? null : JSON.stringify(payload));
    if (xhr.status !== 200) throw new Error('预览服务 ' + route + ' 返回 ' + xhr.status);
    return xhr.responseText;
  }
  window.CsNative = {
    http: function (requestJson) { return call('POST', '/__http', JSON.parse(requestJson)); },
    secretGet: function (key) { return call('POST', '/__secret-get', { key: key }); },
    secretSet: function (key, value) { call('POST', '/__secret-set', { key: key, value: value }); },
    plainGet: function (key) { return call('POST', '/__plain-get', { key: key }); },
    plainSet: function (key, value) { call('POST', '/__plain-set', { key: key, value: value }); },
    log: function (level, message) { call('POST', '/__log', { level: level, message: message }); },
    login: function () { call('POST', '/__login', {}); },
    info: function () { return JSON.stringify({ package: 'preview', version: '预览', webview: navigator.userAgent.match(/Chrome\\/(\\d+)/)?.[1] || '?', os: navigator.platform }); },
  };
  window.CsHost = window.CsHost || {};
  window.CsHost.preview = true;
})();
`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function json(response, value) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(typeof value === 'string' ? value : JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', chunk => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) { reject(new Error('请求体过大')); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

// 与 HttpBridge.java 同契约：只放 HTTPS、不跟跳转、头字段小写、按 content-type 的 charset 解码。
async function forward(payload) {
  const url = new URL(payload.url);
  if (url.protocol !== 'https:') return { error: '只允许 HTTPS 请求：' + url.protocol + '//' + url.host };
  const headers = { 'Accept-Encoding': 'identity', ...(payload.headers || {}) };
  const init = { method: (payload.method || 'GET').toUpperCase(), headers, redirect: 'manual' };
  if (payload.body != null) init.body = String(payload.body);
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return { error: error.cause?.code || error.message };
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_BODY_BYTES) return { error: '响应超过 32MB，这个接口不该返回这么大' };
  const charset = /charset=([\w-]+)/i.exec(response.headers.get('content-type') || '')?.[1] || 'utf8';
  const fields = {};
  for (const [name, value] of response.headers) fields[name.toLowerCase()] = value;
  return { status: response.status, body: buffer.toString(charset === 'utf-8' ? 'utf8' : charset), headers: fields };
}

function asset(name) {
  const file = path.join(WWW, name);
  if (!file.startsWith(WWW + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return file;
}

const server = http.createServer((request, response) => {
  const route = decodeURIComponent(request.url.split('?')[0]);
  if (route === '/__bridge.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(BRIDGE);
    return;
  }
  if (route.startsWith('/__') && request.method === 'POST') {
    readBody(request).then(raw => {
      const payload = raw ? JSON.parse(raw) : {};
      if (route === '/__http') return forward(payload).then(result => json(response, result));
      if (route === '/__secret-get') return json(response, store.secrets[payload.key] || '');
      if (route === '/__secret-set') { store.secrets[payload.key] = payload.value; saveStore(); return json(response, ''); }
      if (route === '/__plain-get') return json(response, store.plain[payload.key] || '');
      if (route === '/__plain-set') { store.plain[payload.key] = payload.value; saveStore(); return json(response, ''); }
      if (route === '/__log') { console.log(`[页面 ${payload.level}] ${payload.message}`); return json(response, ''); }
      if (route === '/__login') { console.log('[预览] 登录窗口在手机上才是真的，这里只记一笔；用「改用手动粘贴 Cookie」走凭据路径'); return json(response, ''); }
      return json(response, { error: '未知的预览接口 ' + route });
    }).catch(error => json(response, { error: error.message }));
    return;
  }
  const name = route === '/' ? 'index.html' : route.replace(/^\/+/, '');
  const file = asset(name);
  if (!file) { response.writeHead(404).end('not found'); return; }
  let body = fs.readFileSync(file);
  // 只在开发服务里插一行桥脚本，磁盘上的 index.html 保持和 apk 完全一致。
  if (name === 'index.html') {
    body = Buffer.from(body.toString('utf8').replace(
      /(<script src="cloudsave-modules\.js"><\/script>)/,
      '<script src="/__bridge.js"></script>\n$1'));
  }
  response.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(body);
});

if (!fs.existsSync(path.join(WWW, 'cloudsave-modules.js'))) {
  console.error('还没有打包产物，先跑：node android-app/tools/bundle.cjs');
  process.exit(1);
}
server.listen(port, '127.0.0.1', () => {
  console.log(`手机页面预览：http://127.0.0.1:${port}/  （存储 ${dataFile}）`);
  console.log('原生桥里 login 是打开系统 WebView 登录窗，这里只打印一行；要验凭据路径请粘贴 Cookie。');
});
