// 手机端 APK 的 JS 层。桌面端跑的是源文件，手机端跑的是 bundle 出来的那一份，
// 这里证明两者是同一份代码，而且那份代码在 WebView 的最小环境里真的能跑起来。
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
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
  // 1. 打包清单：4 个 115 模块 + 资源库这条链（站点读取、翻页缓存），再加已接进手机的三个站点。
  //    清单就是手机能做多少件事的边界：不在这里的模块，资源库那个站点一定点不开。
  assert.deepEqual(bundle.MODULES, [
    'share115-api.js', 'share115-provider.js', 'share115-verify.js', 'share115-filters.js',
    'site-reader.js', 'filtered-library-pages.js',
    'btbtla-provider.js', 'qmp4-provider.js', 'jying-rate-limit.js', 'jying-provider.js',
  ]);
  // Node 内置依赖必须逐个登记为「运行时提供」，否则打包期就会悄悄漏掉一个真实缺失。
  assert.deepEqual(bundle.HOST_PROVIDED, { crypto: 'CsShims.crypto' });
  assert.equal(bundle.SOURCE_DIR, repo);
  for (const name of bundle.MODULES) assert.ok(fs.existsSync(path.join(repo, name)), name + ' 不在了，手机端会缺模块');

  const code = bundle.build();
  // 比对用「仓库里那份」的换行形式：检出被 autocrlf 改过时，源文件在盘上是 CRLF，
  // 而打进包里的必须是 LF（提交里存的就是 LF），所以这里先把读出来的源码归一。
  const sources = bundle.MODULES.map(name => read(path.join(repo, name)).replace(/\r\n/g, '\n'));

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

  // 7.1 七味：它对没验证过的网络是「403 + 验证页」一起回，桌面端那段判定必须导出给手机端共用。
  //     判据只有一份，否则手机上会退化成一句「读取失败（403）」，用户不知道该点哪个按钮。
  {
    const qmp4 = loaded['qmp4-provider.js'];
    assert.equal(typeof qmp4.isVerificationPage, 'function', '验证页判定没导出，手机端和桌面端就会各判各的');
    assert.equal(qmp4.isVerificationPage('<div class="cf-chl">checking your browser</div>'), true);
    assert.equal(qmp4.isVerificationPage('<h1>肖申克的救赎 <span class="year">1994</span></h1>'), false);
    // 纯函数对分：地址拼接和桌面端逐字节一致，手机端不会多打或少打一个请求。
    assert.equal(qmp4.catalogPath('mv', 2, { region: '中国', year: '2024' }),
      require('../qmp4-provider').catalogPath('mv', 2, { region: '中国', year: '2024' }));

    const asked = [];
    const verification = '<html><body>系统安全验证</body></html>';
    const blocked = new qmp4.Qmp4Provider({
      diskCache: { get: () => null, set: () => {} }, getInterval: () => 0,
      fetchHtml: async url => { asked.push(new URL(url).pathname); return verification; },
      parseHtml: async () => { throw new Error('验证页不该送去解析'); },
    });
    await assert.rejects(() => blocked.filters(), error => {
      assert.match(error.message, /七味需要网站验证/);
      assert.equal(error.loginRequired, true, '资源库靠 loginRequired 才会在错误下面给出「网站验证」按钮');
      return true;
    });
    assert.deepEqual(asked, ['/vt/1.html'], '七味起手读的地址变了');

    // 验证过了就照旧解析；编号前缀必须是 qm5:，和桌面端同一套（详情页、缓存键都靠它）。
    // 每个 provider 自己记着请求间隔，所以这里一次一事各建一个：省掉测试里那三秒等待。
    asked.length = 0;
    const catalogProvider = new qmp4.Qmp4Provider({
      diskCache: { get: () => null, set: () => {} }, getInterval: () => 0,
      fetchHtml: async url => { asked.push(new URL(url).pathname + new URL(url).search); return '<html>正文</html>'; },
      parseHtml: async (html, kind) => kind === 'catalog'
        ? { items: [{ siteId: '12345', title: '某片', path: '/mv/12345.html', year: '2024' }],
            choices: { genre: [], year: [], region: [], lang: [], sort: [] },
            currentPage: 1, pageLinks: [], hasNext: false }
        : { title: '某片', all_seeds: [], movies_online_seed: {} },
    });
    const listed = await catalogProvider.catalog('mv', 1, {});
    assert.equal(listed.items[0].id, 'qm5:mv:12345');
    assert.equal(listed.items[0].webUrl, 'https://www.qmp4.com/mv/12345.html');
    const detailProvider = new qmp4.Qmp4Provider({
      diskCache: { get: () => null, set: () => {} }, getInterval: () => 0,
      fetchHtml: async url => { asked.push(new URL(url).pathname + new URL(url).search); return '<html>正文</html>'; },
      parseHtml: async () => ({ title: '某片',
        all_seeds: [{ zname: '某片 1080P', zlink: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), zfiles: [] }],
        movies_online_seed: { 七味: [{ link: 'https://115.com/s/abc', seed_name: '某片', date: '今天' }] } }),
    });
    const qmp4Detail = await detailProvider.detail('qm5:mv:12345');
    assert.equal(qmp4Detail.movies_online_seed['七味'][0].link, 'https://115.com/s/abc', '详情里的网盘链接字段名变了，手机端「复制链接」会复制出空');
    assert.deepEqual(asked, [qmp4.catalogPath('mv', 1, {}), '/mv/12345.html'], '七味的目录/详情地址变了');
    // 网站没翻页却回了同一页：报错，不能把重复内容当成新一页（桌面端同一条判据）。
    await assert.rejects(() => new qmp4.Qmp4Provider({
      diskCache: { get: () => null, set: () => {} }, getInterval: () => 0,
      fetchHtml: async () => '<html>正文</html>',
      parseHtml: async () => ({ items: [{ siteId: '1', path: '/mv/1.html' }], choices: {}, currentPage: 1, pageLinks: [], hasNext: true }),
    }).catalog('mv', 2), /七味没有返回请求的页码/);
  }

  // 7.2 聚影：JSON 接口、401 判登录、未登录时 allowLocked 那条「影片信息照样给」的路。
  //     手机端没有 Electron 的 session，凭据由页面按站点存好后从这里读，所以这条链必须在打包结果里跑通。
  {
    const jying = loaded['jying-provider.js'], rate = loaded['jying-rate-limit.js'];
    assert.equal(typeof rate.error, 'function', '限流模块没进清单，聚影撞墙时不会自己停下');
    assert.equal(typeof AbortSignal.timeout, 'function', '测试环境没有 AbortSignal.timeout，这条等于没测（手机上要靠它判站点能力）');
    assert.equal(JSON.stringify(jying.catalogParams('tv', 3, { genre: '7', year: '2023' })),
      JSON.stringify(require('../jying-provider').catalogParams('tv', 3, { genre: '7', year: '2023' })),
      '聚影的查询串和桌面端算出了两个样子，等于换了一套筛选');

    const magnet = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
    const answers = {
      '/api/app/movies/?page=1&page_size=48&count=1&ordering=-created_at&type=movie':
        { json: { results: [{ id: 9, title: '某片', release_year: 2024, magnet_count: 1, netdisk_count: 2 }], page: 1, total_pages: 2, has_more: true } },
      '/api/app/movie/9/detail/': { json: { movie: { id: 9, title: '某片', release_year: 2024, netdisk_count: 2, magnet_count: 1 } } },
      '/api/app/movie/9/resources/?page=1&page_size=100': { status: 401, json: { message: '未登录，请先登录' } },
    };
    const asked = [];
    const make = (overrides = {}) => new jying.JyingProvider(Object.assign({
      diskCache: { get: () => null, set: () => {} },
      getInterval: () => 0,
      context: () => 'anon',
      getAuth: async () => ({ userAgent: 'UA', cookie: '', token: '', csrf: '' }),
      fetcher: async url => {
        const route = new URL(url).pathname + new URL(url).search;
        asked.push(route);
        const hit = answers[route];
        if (!hit) throw new Error('测试里没有这个接口：' + route);
        return { status: hit.status || 200, ok: (hit.status || 200) < 300, url,
          headers: { get: () => null }, json: async () => hit.json };
      },
      readCooldown: () => ({}), writeCooldown: () => {},
      wait: async () => {}, clock: () => Date.now(),
    }, overrides));

    const anon = make();
    const page = await anon.catalog('mv', 1, {});
    assert.equal(page.items[0].id, 'jy4:mv:9', '聚影编号前缀变了，详情和缓存键都会对不上');
    assert.equal(page.items[0].magnetCount, 1, '列表上的磁力数没带出来，卡片那行会空一格');
    // 资源接口要登录：401 必须翻成 loginRequired，界面才给得出「登录聚影」按钮。
    await assert.rejects(() => anon.resources('jy4:mv:9'), error => {
      assert.equal(error.loginRequired, true);
      assert.match(error.message, /需要登录/);
      return true;
    });
    // allowLocked 是桌面端 jying-detail 那条路：未登录也把影片信息给出来，资源那块换成「需要登录」。
    const locked = await anon.detail('jy4:mv:9', { allowLocked: true });
    assert.equal(locked.resourceAccessRequired, true);
    assert.equal(locked.title, '某片', '未登录时连影片信息都没了，allowLocked 就成了空话');
    assert.equal(locked.all_seeds.length, 0, '未登录却给出了种子');
    // 登录后：磁力直接可复制；网盘链接走 clouds()，字段是 url（手机端的「读取网盘链接」按这个取）。
    answers['/api/app/movie/9/resources/?page=1&page_size=100'] = { json: { resources: [
      { id: 70, title: '某片 1080P', resource_type: 'MagnetLink', share_link: magnet, file_size_bytes: 1073741824, resolution: '1080P' },
      { id: 71, title: '某片 网盘', resource_type: 'Netdisk115', share_link: 'https://115.com/s/abc', extraction_code: '1234' },
    ], has_more: false } };
    const signed = await make().detail('jy4:mv:9', { allowLocked: true });
    assert.equal(signed.all_seeds.length, 1, '磁力没进 all_seeds');
    assert.equal(signed.all_seeds[0].zlink, magnet);
    assert.equal(signed.all_seeds[0].zsize, '1GB');
    assert.equal(signed.movies_online_seed['聚影'].length, 0, '详情里的网盘链接不该是磁力那几条');
    const clouds = await make().clouds('jy4:mv:9');
    // vm 里造的对象和这边要求 strict deepEqual，跨 realm 的原型不同会被判成不相等，所以比序列化结果。
    assert.equal(JSON.stringify(clouds.map(row => [row.url, row.code])),
      JSON.stringify([['https://115.com/s/abc', '1234']]),
      'clouds() 的字段名不是 url/code，手机端读出来的网盘链接会全是空');

    // 限流：429 之后要进冷静期，并且下一次请求在本地就被拦住，不再去敲网站的门。
    const cooled = [];
    answers['/api/app/movies/?page=1&page_size=48&count=1&ordering=-created_at&type=movie'] = { status: 429, json: { retry_after: 60 } };
    const limited = make({ clock: () => 1000, writeCooldown: value => cooled.push(value) });
    await assert.rejects(() => limited.catalog('mv', 1, {}), /冷静期/);
    assert.equal(cooled.length, 1, '冷静期没落盘，重启手机后又会照样撞墙');
    asked.length = 0;
    await assert.rejects(() => make({ clock: () => 1000, readCooldown: () => cooled[0] }).catalog('mv', 1, {}), /冷静期/);
    assert.deepEqual(asked, [], '还在冷静期里就又发了请求，限流等于没生效');
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
  //     站点自己的凭据（七味的验证 Cookie、聚影的登录态）是另一回事——那条走 8.4。
  assert.doesNotMatch(libjs, /CsNative\.login|secret\(['"]cookie115['"]\)|setSecret\(['"]cookie115['"]\)/,
    '资源库不该读 115 的登录凭据，也不该自己直接开原生登录窗');
  assert.match(libjs, /secret\('site:' \+ site\.id\)/, '站点凭据必须按站点分键，否则七味的验证 Cookie 会串进聚影');
  assert.match(shelljs, /switchTab\(window\.CsStore\.get\('tab', 'library'\)\)/, '默认必须落在资源库，不然旧用户还是被登录页挡着');
  assert.match(shelljs, /if \(!window\.CsStore\) return;/, 'host.js 判定 WebView 过旧时 CsStore 还没建起来，这里必须提前退出');
  assert.match(libjs, /SITES\.some\(function \(site\) \{ return !modules\[site\.module\]/,
    '打包清单缺模块时资源库要整块静默退出；留下「能用的站点」只会让人以为那个站点本来就没做');

  // 8.2 资源库只走 WebView 自带的 DOMParser：桌面端那层隐藏 BrowserWindow 在手机上不存在。
  assert.match(libjs, /parseHtml: function \(html, kind, url\) \{ return parseHtml\(site, html, kind, url\); \}/,
    '解析注入点没接上，读取会退回桌面端的 BrowserWindow 路径');
  assert.doesNotMatch(libjs, /parseInWindow\s*\(|BrowserWindow:/, '手机端没有 Electron，把桌面端那层壳接进来就是死路');
  assert.match(libjs, /extra === true && site\.binary[\s\S]{0,200}还不能读取 \.torrent 文件本体/,
    '二进制请求要显式拒绝，不能让原生桥悄悄返回半个字节');

  // 8.3 三个站点都登记在界面上，各自的凭据方式按实测行为写：七味是「403 + 验证页」，聚影是「401 才要登录」。
  for (const id of ['btbtla', 'qmp4', 'jying']) assert.ok(new RegExp("id: '" + id + "'").test(libjs), '资源库少了站点 ' + id);
  assert.match(libjs, /challengePage: true/, '七味的验证页连着 403 一起回，正文必须交回 provider 判，不然只剩一句「读取失败（403）」');
  assert.match(libjs, /typeof AbortSignal\.timeout === 'function'/, '聚影的接口层用了 Chrome 97 才有的超时信号，站点要按运行时能力判，不按版本号猜');
  assert.match(libjs, /allowLocked: true/, '聚影未登录时也要把影片信息给出来——桌面端 jying-detail 走的同一条路');
  assert.match(libjs, /lazyCloudRow/, '聚影的网盘链接不在详情接口里，要有点一下才读的那条路');

  // 8.4 登录窗原生层只有一个，回来的凭据按地址认领：115 只认 115 的域名，资源库只认登记过的站点。
  assert.match(shelljs, /window\.CsHost\.onLoginResult = function/, '认领式分发没了，两份凭据会互相覆盖');
  assert.match(shelljs, /if \(loginHandlers\[index\]\(result\)\) return;/, '谁认领成功就停，不能让两个面板都写一遍');
  assert.match(appjs, /onLoginResult\(function \(payload\)[\s\S]{0,220}115\\\.com/,
    '转存面板要先按地址认领，别把七味的 Cookie 当 115 凭据存下去');
  assert.doesNotMatch(appjs, /window\.CsHost\.onLogin =/, '面板不许再直接占用这个口子');
  assert.match(libjs, /window\.CsHost\.onLoginResult\(function \(payload\)/);
  assert.match(hostjs, /login: function \(request\)[\s\S]{0,120}native\.login\(/, '登录窗要能带站点参数，不然资源库只能开 115 那一页');

  // 8.5 站点凭据存下来以后必须真的用出去：下一次请求带同一个 Cookie 头，而且带上取到它时那个 UA。
  //     这是「验证过/登录过」在手机上唯一看得见的效果，少了它那两个按钮就等于只是改了界面文案。
  //     （预览台里实测过这条：夹具回一份凭据，之后三条 jying.top 请求各带 55 字节 Cookie；没存凭据之前一条都没有。）
  assert.match(libjs, /if \(saved\.cookie\) headers\.Cookie = saved\.cookie/,
    '存好的站点凭据没进请求头，验证和登录就只是文案');
  assert.match(libjs, /'User-Agent': saved\.ua/, '凭据要和取到它时那个 UA 成对发出去，换 UA 很多站点直接判成没登录');
  // 窗口取消时原生层回的是 {cancelled, url}，没有 cookie；那种情况必须原样留着本机那份。
  assert.match(libjs, /if \(!result\.cookie\) \{[\s\S]{0,200}return true;\s*\}/,
    '没取到凭据也要认领这个地址，但不能把本机已存的站点凭据覆盖成空的');

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
  const nativeCalls = [], nativeLogs = [], loginCalls = [];
  let nativeAnswer = JSON.stringify({ status: 200, body: '{"state":true}', headers: { 'content-type': 'application/json' } });
  const hostContext = {
    document: { getElementById: () => null },
    setTimeout,
    window: { CloudSave: {}, CsNative: {
      http: raw => { nativeCalls.push(JSON.parse(raw)); return nativeAnswer; },
      secretGet: () => '', secretSet: () => {}, plainGet: key => (key === 'known' ? 'v' : ''), plainSet: () => {},
      log: (level, message) => nativeLogs.push(level + ':' + message), login: raw => loginCalls.push(raw || ''), info: () => '{"abi":"arm64-v8a"}',
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

  // 9.1 登录窗现在带参数（资源库要在七味的验证页/聚影的登录页上开），不带就是 115 那一页。
  store.login();
  assert.equal(loginCalls[loginCalls.length - 1], '', '不带参数要给原生层空串，让它按默认的 115 登录页打开');
  store.login({ url: 'https://jying.top/login', hint: '登录聚影', wanted: '', storageKeys: 'app_user_token' });
  assert.deepEqual(JSON.parse(loginCalls[loginCalls.length - 1]),
    { url: 'https://jying.top/login', hint: '登录聚影', wanted: '', storageKeys: 'app_user_token' },
    '登录窗参数没原样送进原生层，站点验证就会开错页面');

  // 9.2 聚影那类只回 JSON 的接口：桥要把 body 解析成对象交出去，状态码仍由上层判。
  nativeAnswer = JSON.stringify({ status: 200, body: '{"results":[]}', headers: { 'content-type': 'application/json' } });
  assert.equal(JSON.stringify(await (await hostContext.fetch('https://jying.top/api/app/movies/')).json()),
    JSON.stringify({ results: [] }));
  nativeAnswer = JSON.stringify({ status: 200, body: '不是 JSON', headers: {} });
  await assert.rejects(async () => (await hostContext.fetch('https://jying.top/api/app/movies/')).json(), /无法解析|Unexpected/,
    '解析失败要炸出来，桥不许悄悄换成空对象让上层以为「没有结果」');

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

  // 12. 同一份提交在任何机器上都要算出同一个包。宿主 core.autocrlf=true 时检出会把源码改成 CRLF，
  // 而打包是逐字节内联，所以这里照那份「被改过的检出」真打一遍：结果必须和这里一个字节都不差。
  assert.doesNotMatch(code, /\r/, '打包结果里有 CRLF 换行：apk 会随检出方式变化，不再可复现');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-eol-'));
  try {
    const tools = path.join(scratch, 'android-app', 'tools');
    fs.mkdirSync(tools, { recursive: true });
    fs.copyFileSync(path.join(app, 'tools', 'bundle.cjs'), path.join(tools, 'bundle.cjs'));
    fs.mkdirSync(path.join(scratch, 'cloudsave-windows'), { recursive: true });
    for (const name of bundle.MODULES)
      // 先归一再改坏：这份检出本身可能已经是 CRLF，直接 replace 会写成 CR CR LF，
      // 那就不是在模拟「autocrlf 的检出」，而是在造一种 git 造不出来的文件。
      fs.writeFileSync(path.join(scratch, 'cloudsave-windows', name),
        read(path.join(repo, name)).replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    const report = execFileSync(process.execPath, [path.join(tools, 'bundle.cjs')], { cwd: scratch, encoding: 'utf8' });
    assert.match(report, /CRLF 归一/, 'CRLF 检出没走归一这条路，测试没测到东西');
    assert.equal(read(path.join(scratch, 'android-app', 'assets', 'www', 'cloudsave-modules.js')), code,
      'CRLF 检出打出了另一个包，apk 哈希不可复现');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  // .gitattributes 是这条的第一道保险：检出就直接给 LF，别把它删了。
  const attrs = read(path.join(app, '..', '.gitattributes'));
  for (const kind of ['*.js', '*.cjs', '*.html', '*.css'])
    assert.match(attrs, new RegExp(kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' text eol=lf'),
      `.gitattributes 少了「${kind} text eol=lf」，检出换行会随本机 core.autocrlf 变化`);

  console.log('PASS 打包清单与内联源码、无 require 环境求值、导出对得上、依赖表与运行时注入登记、桌面端解析一致、打包后转存与逐项核验、未核验落地仍报 uncertain、资源库三个站点（BT影视/七味/聚影）目录与详情跑得通、验证页与 401 都翻成 loginRequired、冷静期落盘且不再敲网站、分片与换账户语义保留、不强制登录、凭据按站点分键且登录窗按地址认领、原生桥仅 HTTPS、脚本顺序与控件引用齐全、产物不陈旧、换行随检出稳定');
})().catch(error => { console.error(error); process.exitCode = 1; });
