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

// WebView 里只有这些：没有 require/process/Buffer，也没有 DOMParser 之外的桌面能力。
// 给少了会误报，给多了会漏掉真实缺失。DOMParser 不给：手机端只是把它接进 parseHtml 注入点，
// 真正的 HTML 解析由实机（或 tools/preview.cjs 的浏览器测试台）负责。
function sandbox(options = {}) {
  const context = {
    window: {}, console, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    setInterval, clearInterval, Promise, AbortController, AbortSignal,
    fetch: () => { throw new Error('页面自己不应该发 fetch，这里只测模块'); },
  };
  // 只在需要时给出：平时 Buffer/CsShims 根本不存在，缺失会炸成 ReferenceError 而不是悄悄变 undefined。
  if (options.Buffer) context.Buffer = Buffer;
  // 注入点挂在 window 上：包里的 hostValue 查的就是 IIFE 收到的那个 global（页面里等于 window）。
  if (options.CsShims) context.window.CsShims = options.CsShims;
  return context;
}

(async () => {
  // 1. 打包清单：4 个 115 模块 + 资源库这条链（站点读取、翻页缓存、BT影视解析）。
  assert.deepEqual(bundle.MODULES, [
    'share115-api.js', 'share115-provider.js', 'share115-verify.js', 'share115-filters.js',
    'site-reader.js', 'filtered-library-pages.js', 'btbtla-provider.js',
  ]);
  // Node 内置依赖必须逐个登记为「运行时提供」，否则打包期就会悄悄漏掉一个真实缺失。
  assert.deepEqual(bundle.HOST_PROVIDED, { crypto: 'CsShims.crypto' });
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

  // 4. 模块之间的 require 走打包表，不碰 Node；Node 内置的走运行时注入，且必须登记过。
  const tableLine = code.match(/^var table = (\{.*\});$/m);
  assert.ok(tableLine, '找不到依赖表');
  const table = JSON.parse(tableLine[1]);
  const hostNames = Object.values(bundle.HOST_PROVIDED);
  for (const name of bundle.MODULES) {
    for (const specifier of [...read(path.join(repo, name)).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])) {
      const target = table[name] && table[name][specifier];
      assert.ok(target, `${name} 的 ${specifier} 没进依赖表`);
      if (target.startsWith('!')) {
        assert.ok(hostNames.includes(target.slice(1)), `${specifier} 指向了未登记的 ${target}`);
        continue;
      }
      assert.ok(bundle.MODULES.includes(target), `${specifier} 指向了清单外的模块`);
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

  // 7. 资源库这条链：在没有 DOMParser、也没有 crypto 的环境里，目录和详情照样跑得通。
  //    手机端「不登录也能浏览」靠的就是这个，只有 .torrent 本体解析才需要桌面端的 crypto。
  {
    const context = sandbox();
    vm.createContext(context);
    vm.runInContext(code, context, { filename: 'cloudsave-modules.js' });
    const lib = context.window.CloudSave['btbtla-provider.js'];
    assert.deepEqual(Object.keys(lib).sort(), Object.keys(require(path.join(repo, 'btbtla-provider.js'))).sort());
    assert.equal(typeof lib.extractHtml, 'function', '解析入口没打进包，资源库只能空转');

    const urls = [];
    const pages = [
      { items: [{ siteId: '123', title: 'A', path: '/detail/123.html', year: '2022' }], choices: { genre: [], region: [], year: [], sort: [] }, currentPage: 2, hasNext: false },
      { items: [{ siteId: '55', title: 'S', path: '/tdown/55.html', seed: true }], choices: { genre: [], region: [], year: [], sort: [] }, currentPage: 1, hasNext: false },
    ];
    const makeProvider = (overrides = {}) => new lib.BtbtlaProvider({
      fetchHtml: async url => { urls.push(new URL(url).pathname + new URL(url).search); return '<html>Stub</html>'; },
      parseHtml: async () => pages[urls.length - 1],
      getInterval: () => 1000,
      diskCache: { get: () => null, set: () => {} },
      ...overrides,
    });

    const catalog = await makeProvider().catalog('mv', 2, {}, {});
    assert.match(urls[0], /^\/type\/movies\/2\/\?a=0&o=0&t=0&y=0$/, '目录页码与筛选没拼进请求地址');
    assert.deepEqual(catalog.items.map(row => [row.id, row.website, row.webUrl]),
      [['bt3:mv:123', 'btbtla', 'https://www.btbtla.com/detail/123.html']], '手机端拿到的编号/地址格式和桌面端不一样');

    // 网站没翻页却回了第一页：必须报错重试，不能把重复内容当成新一页。
    await assert.rejects(() => makeProvider({ parseHtml: async () => ({ ...pages[1], currentPage: 1 }) }).catalog('mv', 2), /分页未跳转/);
    // 停止标志：桌面端靠它收尾，手机端靠取消按钮，语义得一样。
    await assert.rejects(() => makeProvider({ stopped: () => true }).catalog('mv', 1), /BT影视读取已停止/);

    // 详情：列表页给的是种子页地址，逐个读回来才是可复制的磁力。
    urls.length = 0;
    const detailProvider = makeProvider({
      parseHtml: async (html, kind) => kind === 'detail'
        ? { title: 'A', seeds: [{ id: '55', detailPath: '/tdown/55.html', zname: 'A 1080p', zsize: '2.61GB' }] }
        : { title: 'A', zname: 'A 1080p', zsize: '2.61GB', zqxd: '1080P', zlink: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) },
    });
    const detail = await detailProvider.detail('bt3:mv:123');
    assert.equal(JSON.stringify(detail.all_seeds.map(seed => seed.zqxd)), JSON.stringify(['1080P']), '详情没带出清晰度');
    assert.match(detail.all_seeds[0].zlink, /^magnet:\?/, '手机上要能复制出磁力链接');
    assert.deepEqual(urls, ['/detail/123.html', '/tdown/55.html'], '详情读取的地址顺序变了');

    // 磁力离线下载还没接手机：解析 .torrent 本体需要 crypto，这台设备上没有。
    // 最小合法种子：单个 1 字节的 movie，info 段就是 info_hash 的取址范围。
    const infoBytes = Buffer.from('d6:lengthi1e4:name5:moviee');
    const torrent = Buffer.concat([Buffer.from('d4:info'), infoBytes, Buffer.from('e')]);
    const withoutShims = sandbox({ Buffer: true });
    vm.createContext(withoutShims);
    vm.runInContext(code, withoutShims, { filename: 'cloudsave-modules.js' });
    assert.throws(() => withoutShims.window.CloudSave['btbtla-provider.js'].decodeTorrent(withoutShims.Buffer.from(torrent)),
      /这台设备上没有 CsShims\.crypto.*只在桌面端可用/s);

    // 给了 shim 就必须算出和 Node 一样的 info_hash——证明这条缝真的接通，不是摆设。
    const withShims = sandbox({ Buffer: true, CsShims: { crypto: require('crypto') } });
    vm.createContext(withShims);
    vm.runInContext(code, withShims, { filename: 'cloudsave-modules.js' });
    const decoded = withShims.window.CloudSave['btbtla-provider.js'].decodeTorrent(withShims.Buffer.from(torrent));
    assert.equal(decoded.hash, require('crypto').createHash('sha1').update(infoBytes).digest('hex'),
      'shim 给通了却算不出正确的 info_hash，磁力离线下载接上手机时会下错种子');
    assert.equal(JSON.stringify(decoded.zfiles), JSON.stringify([{ name: 'movie', size: String(1 / 1073741824) + 'GB', bytes: 1 }]));

    // 站点读取与翻页缓存两个模块也在清单里，缺一个资源库就会退化成「每次重新抓取」。
    const reader = context.window.CloudSave['site-reader.js'];
    assert.equal(typeof reader.ReadQueue, 'function');
    assert.equal(typeof context.window.CloudSave['filtered-library-pages.js'].FilteredLibraryPages, 'function');
    // 卡住的请求必须在超时后自己失败，不能把手机端吊在那里。
    await assert.rejects(() => reader.bounded(() => new Promise(() => {}), 5, 'BT影视请求', {}), /BT影视请求超时/);
  }

  // 8. 手机端应用层要守住桌面端的几条关键语义，改了这里就等于改了行为。
  const appjs = read(path.join(app, 'assets', 'www', 'app.js'));
  const hostjs = read(path.join(app, 'assets', 'www', 'host.js'));
  const shelljs = read(path.join(app, 'assets', 'www', 'shell.js'));
  const libjs = read(path.join(app, 'assets', 'www', 'library.js'));
  const monitor = read(path.join(repo, 'share115-monitor.js'));
  assert.equal(Number(appjs.match(/var CHUNK = (\d+)/)[1]), 50, '分片必须和桌面端一致');
  assert.match(monitor, /start \+= 50|start\+=50/);
  assert.match(appjs, /账户已更换/, '每片前重新确认账户这条语义丢了');
  assert.match(monitor, /网盘账户已更换/);
  assert.match(appjs, /files:\s*chunk,\s*active:\s*active/, '核验要交给 provider 逐项比对');
  for (const source of [appjs, hostjs, shelljs, libjs]) new Function(source);   // 语法门槛：整份文件必须能被当前引擎解析

  // 8.1 取消强制登录：资源库这条页不许碰 115 的凭据，起手也不能停在转存页。
  assert.doesNotMatch(libjs, /secret\(['"]cookie['"]\)|CsNative\.login/, '资源库不该依赖 115 登录/登录窗');
  assert.match(shelljs, /switchTab\(window\.CsStore\.get\('tab', 'library'\)\)/, '默认必须落在资源库，不然旧用户还是被登录页挡着');
  assert.match(shelljs, /if \(!window\.CsStore\) return;/, 'host.js 判定 WebView 过旧时 CsStore 还没建起来，这里必须提前退出');
  assert.match(libjs, /if \(!phone \|\| !btbtla\) return;/, '模块没加载成功时资源库要静默退出，不能整页报错');

  // 8.2 资源库只走 WebView 自带的 DOMParser：桌面端那层隐藏 BrowserWindow 在手机上不存在。
  assert.match(libjs, /parseHtml: parseHtml/, '解析注入点没接上，读取会退回桌面端的 BrowserWindow 路径');
  assert.doesNotMatch(libjs, /parseInWindow\s*\(|BrowserWindow:/, '手机端没有 Electron，把桌面端那层壳接进来就是死路');
  assert.match(libjs, /if \(binary\)[\s\S]{0,120}原生桥目前只回文本/, '二进制请求要显式拒绝，不能让原生桥悄悄返回半个字节');

  // 9. 原生桥只留 fetch 一个入口，且只走 HTTPS。这里真的把 host.js 跑起来，用假 CsNative 验收协议。
  assert.match(hostjs, /globalThis\.fetch\s*=/);
  assert.doesNotMatch(hostjs, /require\(/);
  // 判据不能依赖 eval：加了 CSP 的页面里 new Function 会被拦，误判成「WebView 太旧」。
  // （只拦真实调用，host.js 里那段解释为什么不这么写的注释不算。）
  assert.doesNotMatch(hostjs, /new Function\(|[^a-zA-Z]eval\(/, '起手探测不许用 eval');
  assert.match(hostjs, /WebView 升级到 92|WebView 版本过旧/);
  assert.match(hostjs, /!window\.CloudSave \|\| !Array\.prototype\.at/, '过旧判定要同时看模块包和运行时才用到的新 API');
  // 这一版不加 CSP：file:// 页面里内联脚本的组合在这台机器上没法实测，不值得拿实机去赌白屏。
  assert.doesNotMatch(read(path.join(app, 'assets', 'www', 'index.html')), /Content-Security-Policy/);
  const nativeCalls = [], nativeLogs = [];
  let nativeAnswer = JSON.stringify({ status: 200, body: '{"state":true}', headers: { 'content-type': 'application/json' } });
  const hostContext = {
    document: { getElementById: () => null },
    setTimeout,
    window: { CloudSave: {}, CsNative: {
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

  // 10. 页面结构：脚本顺序与三份页面脚本用到的每个控件都得真实存在。
  const html = read(path.join(app, 'assets', 'www', 'index.html'));
  const scripts = ['cloudsave-modules.js', 'host.js', 'shell.js', 'app.js', 'library.js'];
  const order = scripts.map(name => html.indexOf(name));
  assert.ok(order.every(index => index >= 0), '页面少了某个脚本：' + scripts.filter((n, i) => order[i] < 0).join(', '));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), '脚本顺序错了，页面起手就拿不到模块、桥或共享外壳');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  // 标签页必须都在页面里，否则 shell.js 一上来就点不到。
  for (const id of ['tab-library', 'tab-transfer', 'panel-library', 'panel-transfer']) assert.ok(ids.has(id), '缺少标签控件 ' + id);
  const used = new Set();
  for (const source of [appjs, libjs, shelljs]) [...source.matchAll(/\$\('([^']+)'\)/g)].forEach(m => used.add(m[1]));
  assert.deepEqual([...used].filter(id => !ids.has(id)), [], '页面脚本引用了不存在的控件');
  assert.ok(used.size > 25, '控件覆盖率比上一版还低，说明有引用被删掉了');
  assert.ok([...hostjs.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]).every(id => ids.has(id)));
  // 资源库这一页不能要求任何网盘登录：登录按钮只属于转存面板。
  const libraryPanel = html.slice(html.indexOf('id="panel-library"'), html.indexOf('id="panel-transfer"'));
  assert.doesNotMatch(libraryPanel, /id="login"|id="cookie"|id="paste-toggle"/, '资源库里又冒出登录控件，等于把用户挡在门外');

  // 11. 构建产物不能是旧的：只要 assets 里那份存在，就必须和当前源码一致。
  const emitted = path.join(app, 'assets', 'www', 'cloudsave-modules.js');
  if (fs.existsSync(emitted)) assert.equal(read(emitted), code, 'APK 里的模块是旧构建，重新跑 node tools/bundle.cjs');

  // 12. 同一份提交在任何机器上都要算出同一个包。打包是逐字节内联，所以源码换行必须是 LF；
  // 宿主 core.autocrlf=true 会在检出时改成 CRLF，那台机器打出的 apk 就和这台的差几十个字节。
  assert.doesNotMatch(code, /\r/, '打包结果里有 CRLF 换行：这份检出改过源码换行，apk 不再是可复现的');
  const attrs = read(path.join(app, '..', '.gitattributes'));
  for (const kind of ['*.js', '*.cjs', '*.html', '*.css'])
    assert.match(attrs, new RegExp(kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' text eol=lf'),
      `.gitattributes 少了「${kind} text eol=lf」，检出换行会随本机 core.autocrlf 变化`);

  console.log('PASS 打包清单与内联源码、无 require 环境求值、导出对得上、依赖表与运行时注入登记、桌面端解析一致、打包后转存与逐项核验、未核验落地仍报 uncertain、资源库目录与详情跑得通且缺失才报「只在桌面端」、分片与换账户语义保留、不强制登录、原生桥仅 HTTPS、脚本顺序与控件引用齐全、产物不陈旧、换行随检出稳定');
})().catch(error => { console.error(error); process.exitCode = 1; });
