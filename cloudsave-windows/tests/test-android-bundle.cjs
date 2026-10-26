// 手机端 APK 的 JS 层。桌面端跑的是源文件，手机端跑的是 bundle 出来的那一份，
// 这里证明两者是同一份代码，而且那份代码在 WebView 的最小环境里真的能跑起来。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '..');
const app = path.resolve(repo, '..', 'android-app');
const bundle = require(path.join(app, 'tools', 'bundle.cjs'));
const read = file => fs.readFileSync(file, 'utf8');

// WebView 里只有这些：没有 require/process/Buffer。给少了会误报，给多了会漏掉真实缺失。
function sandbox() {
  return {
    window: {}, console, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    fetch: () => { throw new Error('页面自己不应该发 fetch，这里只测模块'); },
  };
}

(async () => {
  // 1. 打包清单就是那四个模块，不多不少；手机端第一轮只覆盖 115 链路。
  assert.deepEqual(bundle.MODULES, ['share115-api.js', 'share115-provider.js', 'share115-verify.js', 'share115-filters.js']);
  assert.equal(bundle.SOURCE_DIR, repo);
  for (const name of bundle.MODULES) assert.ok(fs.existsSync(path.join(repo, name)), name + ' 不在了，手机端会缺模块');

  const code = bundle.build();
  const sources = bundle.MODULES.map(name => read(path.join(repo, name)));

  // 2. 直接内联源文件，不转译不改写：手机跑的每个字节都是仓库里的那一份。
  for (const source of sources) assert.ok(code.includes(source), '打包结果和源文件不一致，bundle 被改成了另一份实现');
  assert.ok(code.length > sources.reduce((a, b) => a + b.length, 0), '只有模块本体，运行时壳没了？');

  // 3. 在没有 require 的环境里求值，任何漏网的 Node 依赖都会在这里炸成 ReferenceError。
  const context = sandbox();
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'cloudsave-modules.js' });
  assert.equal(vm.runInContext('typeof require', context), 'undefined');
  const loaded = context.window.CloudSave;
  assert.deepEqual(Object.keys(loaded).sort(), [...bundle.MODULES].sort());
  for (const name of bundle.MODULES) assert.deepEqual(Object.keys(loaded[name]).sort(), Object.keys(require(path.join(repo, name))).sort(), name + ' 的导出对不上');

  // 4. 模块之间的 require 走打包表，不碰 Node。
  const tableLine = code.match(/^var table = (\{.*\});$/m);
  assert.ok(tableLine, '找不到依赖表');
  const table = JSON.parse(tableLine[1]);
  for (const name of bundle.MODULES) {
    for (const specifier of [...read(path.join(repo, name)).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])) {
      assert.ok(table[name] && table[name][specifier], `${name} 的 ${specifier} 没进依赖表`);
      assert.ok(bundle.MODULES.includes(table[name][specifier]), `${specifier} 指向了清单外的模块`);
    }
  }

  // 5. 行为与桌面端一致：同一句响应文本，两边解析结果必须完全相同。
  const api = loaded['share115-api.js'], provider = loaded['share115-provider.js'], filters = loaded['share115-filters.js'];
  const rawText = '{"uid":1234567890123456789,"list":[{"fid":"7","n":"episode.mkv","s":1073741824}]}';
  // 跨 realm 的对象原型不同，只能比序列化结果。
  assert.equal(JSON.stringify(api.parse115Json(rawText)), JSON.stringify(require('../share115-api').parse115Json(rawText)));
  assert.equal(JSON.stringify(provider.parseShare('https://115.com/s/abcde#nwqf')), JSON.stringify({ shareCode: 'abcde', receiveCode: 'nwqf', url: 'https://115.com/s/abcde' }));
  assert.equal(provider.parseShare('https://pan.baidu.com/s/abcde'), null);
  assert.equal(JSON.stringify(filters.formats('.MKV，mp4 MKV')), JSON.stringify(['mkv', 'mp4']));
  assert.equal(filters.sizeGB('1.5 GB'), require('../share115-filters').sizeGB('1.5 GB'));

  // 6. 转存 + 逐项核验整条链路在打包结果里跑得通（这一步会跨到 share115-verify 模块）。
  const row = { fid: '501', id: '501', n: 'episode.mkv', s: 1073741824 };
  const makeProvider = targetRows => new provider.Share115Provider({
    check: result => { if (result.state !== true) throw new Error(result.error || '115失败'); },
    wait: async () => {},
    request: async url => {
      const target = new URL(url);
      if (target.pathname === '/share/snap') return { state: true, data: { count: 1, list: [row] } };
      if (target.pathname === '/share/receive') return { state: true };
      if (target.pathname === '/files') return { state: true, data: { list: targetRows }, path: [{ cid: target.searchParams.get('cid'), name: '待归档' }], count: targetRows.length };
      throw new Error('测试里没有这个接口：' + target.pathname);
    },
  });
  const listed = await makeProvider([]).list({ shareCode: 'abcde', receiveCode: '' }, 'UID=1', () => {});
  assert.equal(JSON.stringify(listed), JSON.stringify([row]));
  const receipt = await makeProvider([{ fid: '900', n: 'episode.mkv', s: 1073741824 }])
    .receive({ shareCode: 'abcde', receiveCode: '' }, ['501'], '42', 'UID=1', { files: [row], active: () => {} });
  assert.equal(receipt.state, true);
  assert.equal(receipt.verification.verified, true, '打包后核验没有真正执行');

  // 目标目录没有落地时，必须报“结果待核对”并且带上 uncertain，绝不重复提交——桌面端也是这套语义。
  await assert.rejects(
    () => makeProvider([]).receive({ shareCode: 'abcde', receiveCode: '' }, ['501'], '42', 'UID=1', { files: [row], active: () => {} }),
    error => {
      assert.match(error.message, /已接受，但目标目录保存未核验通过/);
      assert.equal(error.uncertain, true);
      assert.equal(error.serverResult.state, true, '要把服务器已接受这件事带出来');
      return true;
    });

  // 7. 手机端应用层要守住桌面端的几条关键语义，改了这里就等于改了行为。
  const appjs = read(path.join(app, 'assets', 'www', 'app.js'));
  const hostjs = read(path.join(app, 'assets', 'www', 'host.js'));
  const monitor = read(path.join(repo, 'share115-monitor.js'));
  assert.equal(Number(appjs.match(/var CHUNK = (\d+)/)[1]), 50, '分片必须和桌面端一致');
  assert.match(monitor, /start \+= 50|start\+=50/);
  assert.match(appjs, /账户已更换/, '每片前重新确认账户这条语义丢了');
  assert.match(monitor, /网盘账户已更换/);
  assert.match(appjs, /files:\s*chunk,\s*active:\s*active/, '核验要交给 provider 逐项比对');
  for (const source of [appjs, hostjs]) new Function(source);   // 语法门槛，配合 host.js 里的 ?. ?? 探测

  // 8. 原生桥只留 fetch 一个入口，且只走 HTTPS。这里真的把 host.js 跑起来，用假 CsNative 验收协议。
  assert.match(hostjs, /globalThis\.fetch\s*=/);
  assert.doesNotMatch(hostjs, /require\(/);
  assert.match(hostjs, /WebView 升级到 80|WebView 版本过旧/);
  const nativeCalls = [], nativeLogs = [];
  let nativeAnswer = JSON.stringify({ status: 200, body: '{"state":true}', headers: { 'content-type': 'application/json' } });
  const hostContext = {
    document: { getElementById: () => null },
    setTimeout,
    window: { CsNative: {
      http: raw => { nativeCalls.push(JSON.parse(raw)); return nativeAnswer; },
      secretGet: () => '', secretSet: () => {}, plainGet: key => (key === 'known' ? 'v' : ''), plainSet: () => {},
      log: (level, message) => nativeLogs.push(level + ':' + message), login: () => {}, info: () => '{"abi":"arm64-v8a"}',
    } },
  };
  vm.createContext(hostContext);
  vm.runInContext(hostjs, hostContext, { filename: 'host.js' });

  await assert.rejects(() => hostContext.fetch('http://115.com/'), /只允许 HTTPS/, '放行 http 会把 Cookie 明文发出去');
  assert.equal(nativeCalls.length, 0, '被拒绝的请求不应该已经发出去');
  const response = await hostContext.fetch('https://webapi.115.com/files', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cid=42' });
  assert.equal(nativeCalls.length, 1);
  assert.equal(nativeCalls[0].url, 'https://webapi.115.com/files');
  assert.equal(nativeCalls[0].method, 'POST');
  assert.equal(nativeCalls[0].body, 'cid=42');
  assert.equal(nativeCalls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(response.status, 200);
  assert.equal(response.ok, true);
  assert.equal(await response.text(), '{"state":true}');
  assert.equal(response.headers.get('Content-Type'), 'application/json', '原生层返回的头是小写，页面按 Fetch 规则大小写不敏感');
  assert.equal(response.headers.get('X-Missing'), null);
  await hostContext.fetch('https://webapi.115.com/files');   // 默认 GET、不带 body、不带自定义头
  assert.equal(nativeCalls[1].method, 'GET');
  assert.equal(nativeCalls[1].body, null);

  nativeAnswer = JSON.stringify({ error: '连接超时' });
  await assert.rejects(() => hostContext.fetch('https://my.115.com/'), /连接超时/);
  nativeAnswer = '这不是 JSON';
  await assert.rejects(() => hostContext.fetch('https://my.115.com/'), /无法解析/);
  nativeAnswer = JSON.stringify({ status: 500, body: 'boom' });
  assert.equal((await hostContext.fetch('https://my.115.com/')).ok, false, '状态码要原样交给上层判定，桥本身不替业务做决定');

  const store = hostContext.window.CsStore;
  assert.equal(store.secret('cookie'), '');
  assert.equal(store.get('folder', '未选择'), '未选择');
  assert.equal(store.get('known'), 'v');
  assert.equal(store.info().abi, 'arm64-v8a');
  store.log('warning', '明文回退');
  assert.deepEqual(nativeLogs, ['warning:明文回退']);

  // 9. 页面结构：脚本顺序与 app.js 用到的每个控件都得真实存在。
  const html = read(path.join(app, 'assets', 'www', 'index.html'));
  const order = ['cloudsave-modules.js', 'host.js', 'app.js'].map(name => html.indexOf(name));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '脚本顺序错了，页面起手就拿不到模块或桥');
  assert.ok(order.every(index => index >= 0));
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...appjs.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  assert.ok([...hostjs.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]).every(id => ids.has(id)));
  assert.deepEqual([...used].filter(id => !ids.has(id)), [], 'app.js 引用了页面里不存在的控件');
  assert.ok(used.size > 10);

  // 10. 构建产物不能是旧的：只要 assets 里那份存在，就必须和当前源码一致。
  const emitted = path.join(app, 'assets', 'www', 'cloudsave-modules.js');
  if (fs.existsSync(emitted)) assert.equal(read(emitted), code, 'APK 里的模块是旧构建，重新跑 node tools/bundle.cjs');

  console.log('PASS 打包清单与内联源码、无 require 环境求值、导出对得上、依赖表完整、桌面端解析一致、打包后转存与逐项核验、未核验落地仍报 uncertain、分片与换账户语义保留、原生桥仅 HTTPS、脚本顺序与控件引用齐全、产物不陈旧');
})().catch(error => { console.error(error); process.exitCode = 1; });
