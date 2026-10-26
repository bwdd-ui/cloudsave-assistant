// 开发用的手机页面预览服务（android-app/tools/preview.cjs）本身也要有测试。
// 这台机器没有安卓设备也没有模拟器，往后每一轮都靠它验界面；它自己不可信，验证就全是空的。
// 这里不联外网：只验契约（同源注入、只放 HTTPS、存储分间、目录不逃逸、页面引用的资源都在）。
const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const app = path.resolve(__dirname, '..', '..', 'android-app');
const www = path.join(app, 'assets', 'www');
const tool = path.join(app, 'tools', 'preview.cjs');

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: route }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body != null) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // 空转端口：先占一个再放开，比固定 8801 安全（那个可能正被开发用的实例占着）。
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const taken = probe.address().port;
      probe.close(() => resolve(taken));
    });
  });
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cs-preview-')), 'store.json');
  const child = spawn(process.execPath, [tool, '--port', String(port), '--data', dataFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });

  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  try {
    // 等服务起来：最多 10 秒，超时就直接失败，不留半死不活的孩子。
    const deadline = Date.now() + 10000;
    for (;;) {
      try { const first = await request(port, 'GET', '/'); if (first.status === 200) break; } catch (error) { /* 还没监听 */ }
      if (Date.now() > deadline) throw new Error('预览服务起不来：' + (output || '没有输出'));
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // 1. 注入的那行桥脚本只存在于服务响应里，磁盘上的 index.html 与 apk 里那份完全一致。
    const served = (await request(port, 'GET', '/')).text;
    assert.ok(served.includes('<script src="/__bridge.js"></script>'), '桥脚本没注入，页面拿不到 CsNative');
    assert.equal(served.replace('<script src="/__bridge.js"></script>\n', ''), fs.readFileSync(path.join(www, 'index.html'), 'utf8'),
      '预览改了页面，验的就不是 apk 里那一份了');

    // 2. 页面引用的每个资源都得真能取到——改名漏一个就是手机上的 ERR_FILE_NOT_FOUND。
    const referenced = [...served.matchAll(/(?:src|href)="(?!https?:|data:|#|\/)([^"]+)"/g)].map(m => m[1]);
    assert.ok(referenced.length >= 6, '页面引用的资源比预期少，正则或页面结构变了');
    for (const name of referenced) {
      const hit = await request(port, 'GET', '/' + name);
      assert.equal(hit.status, 200, name + ' 取不到');
      assert.ok(hit.text.length > 100, name + ' 内容为空');
    }

    // 3. /__http 与原生桥同契约：放行 HTTPS、拦掉其它协议。
    const httpsProbe = await request(port, 'POST', '/__http', { url: 'https://127.0.0.1:1/nope' });
    const parsed = JSON.parse(httpsProbe.text);
    assert.ok(!/只允许 HTTPS/.test(String(parsed.error)), 'https 请求不该被协议门禁拦下：' + parsed.error);
    const blocked = JSON.parse((await request(port, 'POST', '/__http', { url: 'http://115.com/' })).text);
    assert.match(blocked.error, /只允许 HTTPS 请求：http/, '预览服务放行了 http，手机上却会失败——两边契约不一致');

    // 4. 存储分两间：secrets 对应 AndroidKeyStore，plain 对应 SharedPreferences，不能互相看得见。
    //    取值接口回的是裸字符串，和 Java 桥的返回一样，不能再套一层 JSON。
    await request(port, 'POST', '/__secret-set', { key: 'cookie', value: 'UID=1' });
    await request(port, 'POST', '/__plain-set', { key: 'tab', value: 'library' });
    assert.equal((await request(port, 'POST', '/__secret-get', { key: 'cookie' })).text, 'UID=1');
    assert.equal((await request(port, 'POST', '/__plain-get', { key: 'tab' })).text, 'library');
    assert.equal((await request(port, 'POST', '/__secret-get', { key: 'tab' })).text, '', '两间存储串了');
    assert.match(fs.readFileSync(dataFile, 'utf8'), /UID=1/, '落盘的存储里没有刚写进去的凭据');

    // 5. 目录逃逸：解码后拼出的路径必须还在 assets/www 里。
    const escape = await request(port, 'GET', '/%2e%2e%2f%2e%2e%2fcloudsave-windows%2fshare115-api.js');
    assert.equal(escape.status, 404, '预览服务把 assets 外的文件发出来了');

    // 6. 未知接口要报错，而不是悄悄回一个空响应让页面以为成功。
    assert.match(JSON.parse((await request(port, 'POST', '/__nope', {})).text).error, /未知的预览接口/);

    console.log('PASS 预览服务：注入不改盘、页面引用全部可取、仅 HTTPS 出站、secrets/plain 分间并落盘、目录不逃逸、未知接口报错');
  } finally {
    stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
