// 资源库面板：浏览资源网站，不需要任何网盘登录。
// 站点解析用的是桌面端同一份 provider 模块（打包在 cloudsave-modules.js 里），
// 这里只补三件手机端才需要的事：请求走原生桥、HTML 解析走 WebView 自带的 DOMParser、
// 站点自己的凭据（七味的验证 Cookie、聚影的登录态）按站点分开存。
(function () {
  'use strict';

  var phone = window.CsPhone;
  var modules = window.CloudSave || {};
  if (!phone) return;

  var $ = phone.$;

  // 每个站点的分类、筛选字段和凭据方式。站点怎么抓、怎么解析、分页怎么判，全在 provider 模块里，
  // 和桌面端跑的是同一份代码；这里只登记「界面上要给什么控件」，不重复站点逻辑。
  var SITES = [
    {
      id: 'btbtla', label: 'BT影视', module: 'btbtla-provider.js', ctor: 'BtbtlaProvider',
      categories: [['mv', '电影'], ['tv', '剧集'], ['updates', '最新上传']],
      fields: [['genre', '类型'], ['region', '地区'], ['year', '年份'], ['sort', '排序']],
      // 解析 .torrent 本体要 crypto，这台设备上没有；所以这一版只列页面给出的磁力链接。
      binary: '原生桥目前只回文本',
    },
    {
      id: 'qmp4', label: '七味', module: 'qmp4-provider.js', ctor: 'Qmp4Provider',
      categories: [['mv', '电影'], ['tv', '剧集'], ['variety', '综艺'], ['ac', '动漫'], ['short', '短片']],
      fields: [['genre', '类型'], ['region', '地区'], ['year', '年份'], ['lang', '语言'], ['sort', '排序']],
      // 七味对没见过的网络会先弹人机验证；验证过了才给正文，所以给它一个应用内验证入口。
      // 它的验证页是连 403 一起回的，所以正文要交回 provider 判（challengePage），
      // 不然手机上只有一句「读取失败（403）」，用户不知道该点哪个按钮。
      gate: { url: 'https://www.qmp4.com/vt/1.html', hint: '在这个页面里通过人机验证，然后点「完成」', button: '网站验证' },
      challengePage: true,
    },
    {
      id: 'jying', label: '聚影', module: 'jying-provider.js', ctor: 'JyingProvider',
      categories: [['mv', '电影'], ['tv', '剧集'], ['ac', '动漫'], ['doc', '纪录片'],
        ['variety', '综艺'], ['bundle', '合集'], ['other', '其它']],
      fields: [['genre', '分类'], ['tag', '标签'], ['region', '地区'], ['year', '年份'],
        ['res', '资源类型'], ['sort', '排序']],
      json: true,   // 走 JSON 接口，不解析 HTML
      lazyClouds: true,   // 网盘链接不在详情里，点一下才读（见 lazyCloudRow）
      // 列表和影片信息匿名可读；资源链接（磁力/网盘）要登录，所以给它一个登录入口。
      needs: function () { return typeof AbortSignal.timeout === 'function'; },
      needsLabel: '需 WebView 97 以上',
      gate: {
        url: 'https://jying.top/login',
        hint: '在这个页面里登录聚影，然后点「完成」（不登录也能浏览列表）',
        button: '登录聚影',
        storageKeys: 'app_user_token,app_user_token_expires',
      },
    },
  ];

  // 打包清单少了任何一个站点模块就整块退出：把可用的留下、缺的藏起来，看起来就像那个站点没做，
  // 比一句明确的界面故障更难查。
  if (SITES.some(function (site) { return !modules[site.module] || typeof modules[site.module][site.ctor] !== 'function'; })) return;

  var state = current('btbtla');
  var providers = {};

  function current(id) {
    return { site: id, category: (siteById(id).categories[0] || ['mv'])[0], page: 1,
      filters: { search: '' }, choices: null, loading: false };
  }

  function siteById(id) {
    for (var i = 0; i < SITES.length; i++) if (SITES[i].id === id) return SITES[i];
    return SITES[0];
  }

  // 站点凭据按站点分键存：七味的验证 Cookie 和聚影的登录态不会互相串，也不会碰 115 那一份。
  function credential(site) {
    try { return JSON.parse(window.CsStore.secret('site:' + site.id)) || {}; } catch (error) { return {}; }
  }

  function saveCredential(site, patch) {
    var merged = credential(site);
    Object.keys(patch).forEach(function (key) { merged[key] = patch[key]; });
    merged.savedAt = new Date().toISOString();
    window.CsStore.setSecret('site:' + site.id, JSON.stringify(merged));
    return merged;
  }

  function headersFor(site) {
    var saved = credential(site);
    var headers = { 'User-Agent': saved.ua || 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml' };
    if (saved.cookie) headers.Cookie = saved.cookie;
    return headers;
  }

  // 桌面端在主进程里用一个隐藏 BrowserWindow 解析 HTML，因为 Node 没有 DOMParser；
  // WebView 本来就有，所以这里直接原地解析，不再需要那层壳。
  function parseHtml(site, html, kind, url) { return modules[site.module].extractHtml(html, kind, url); }

  function fetchHtml(site, url, extra) {
    if (extra === true && site.binary) {
      return Promise.reject(new Error('手机端还不能读取 .torrent 文件本体（' + site.binary + '），这一版只列站点给出的磁力链接'));
    }
    return globalThis.fetch(url, { headers: headersFor(site) }).then(function (response) {
      if (!response.ok && !site.challengePage) throw new Error(site.label + '读取失败（' + response.status + '）');
      return response.text();
    });
  }

  // 目录结果缓存到本机：手机上一次请求比桌面贵，翻页往返回答更快；存不下就当没缓存。
  function makeCache(site) {
    var memory = new Map();
    var store = {
      get: function (key, ttl) {
        var raw = window.CsStore.get('cache:' + site.id + ':' + key, '');
        if (!raw) return null;
        try {
          var hit = JSON.parse(raw);
          return (Date.now() - hit.at < ttl) ? hit.value : null;
        } catch (error) { return null; }
      },
      set: function (key, value) {
        try { window.CsStore.set('cache:' + site.id + ':' + key, JSON.stringify({ at: Date.now(), value: value })); }
        catch (error) { phone.log('资源库缓存写不下了，这次只留在内存里', 'warning'); }
      },
    };
    return {
      get: function (key, ttl) { return memory.has(key) ? memory.get(key) : store.get(key, ttl); },
      set: function (key, value) {
        memory.set(key, value);
        if (memory.size > 40) memory.delete(memory.keys().next().value);
        store.set(key, value);
      },
    };
  }

  function providerFor(site) {
    if (providers[site.id]) return providers[site.id];
    var Klass = modules[site.module][site.ctor];
    // 手机端没有「停止读取」这个动作（一次翻页就是一条请求），所以不传 stopped：
    // 三个 provider 的构造参数里它都默认 () => false。
    var common = {
      diskCache: makeCache(site),
      getInterval: function () { return 3000; },
    };
    if (site.json) {
      providers[site.id] = new Klass(Object.assign(common, {
        // jying-provider 里写的就是 fetcher(url, options)，其中 options.signal 用 AbortSignal.timeout 造，
        // 那是 Chrome 97 才有的 API；页面级 fetch 已经是原生桥了，所以这里只管继续传。
        fetcher: function (url, options) { return globalThis.fetch(url, options); },
        context: function () { return credential(site).savedAt || 'anon'; },
        getAuth: function () {
          var saved = credential(site);
          var csrf = /(?:^|;\s*)csrftoken=([^;]+)/.exec(saved.cookie || '');
          var expires = Number(saved.tokenExpires || 0);
          return Promise.resolve({
            userAgent: saved.ua || 'Mozilla/5.0',
            cookie: saved.cookie || '',
            token: saved.token && (!expires || expires > Date.now()) ? saved.token : '',
            csrf: csrf ? decodeURIComponent(csrf[1]) : '',
          });
        },
        refreshToken: function (token) { saveCredential(site, { token: token }); },
        readCooldown: function () {
          try { return JSON.parse(window.CsStore.get('cooldown:' + site.id, '')) || {}; } catch (error) { return {}; }
        },
        writeCooldown: function (value) { window.CsStore.set('cooldown:' + site.id, JSON.stringify(value)); },
      }));
    } else {
      providers[site.id] = new Klass(Object.assign(common, {
        fetchHtml: function (url, extra) { return fetchHtml(site, url, extra); },
        parseHtml: function (html, kind, url) { return parseHtml(site, html, kind, url); },
      }));
    }
    return providers[site.id];
  }

  function fill(id, options, selected) {
    var box = $(id);
    box.textContent = '';
    options.forEach(function (option) {
      var node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      box.appendChild(node);
    });
    if (selected != null) box.value = selected;
  }

  // 筛选行按站点现搭：七味多一个「语言」，聚影多「标签」和「资源类型」，
  // 写死三行会在下一个站点上继续长出来，那就又变成一份站点知识。
  function buildFilterRow(site) {
    var row = $('lib-filters');
    row.textContent = '';
    site.fields.forEach(function (pair) {
      var label = document.createElement('label');
      label.className = 'pick';
      var caption = document.createElement('span');
      caption.textContent = pair[1];
      var box = document.createElement('select');
      box.id = 'lib-' + pair[0];
      label.appendChild(caption);
      label.appendChild(box);
      row.appendChild(label);
      box.addEventListener('change', function () { state.filters[pair[0]] = this.value; load(1); });
    });
  }

  function fields() { return siteById(state.site).fields; }

  function renderChoices(choices) {
    state.choices = choices;
    var keep = {};
    fields().forEach(function (pair) { keep[pair[0]] = state.filters[pair[0]]; });
    fields().forEach(function (pair) {
      var box = $('lib-' + pair[0]);
      if (!box) return;
      var rows = choices[pair[0]] || [];
      fill('lib-' + pair[0], [{ value: '', label: rows.length ? '全部' : '网站未提供' }].concat(rows), keep[pair[0]] || '');
      box.disabled = !rows.length;
    });
  }

  function readFilters() {
    var filters = { search: $('lib-search').value.trim() };
    fields().forEach(function (pair) {
      var box = $('lib-' + pair[0]);
      if (box && !box.disabled && box.value) filters[pair[0]] = box.value;
    });
    return filters;
  }

  function card(item) {
    var box = document.createElement('article');
    box.className = 'item';
    if (item.poster) {
      var image = document.createElement('img');
      image.src = item.poster;
      image.alt = '';
      image.loading = 'lazy';
      // 站点偶尔给出失效的海报地址：留下破图标比没有海报更难看。
      image.addEventListener('error', function () { image.remove(); box.classList.add('no-poster'); });
      box.appendChild(image);
    } else {
      box.classList.add('no-poster');
    }
    var text = document.createElement('div');
    text.className = 'item-text';
    var title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = item.title || '（无标题）';
    text.appendChild(title);
    var meta = document.createElement('div');
    meta.className = 'item-meta';
    var counts = [];
    if (item.magnetCount) counts.push('磁力 ' + item.magnetCount);
    if (item.cloudCount) counts.push('网盘 ' + item.cloudCount);
    meta.textContent = [item.year, item.genre, item.score, item.size, item.date].filter(Boolean)
      .concat(counts).join(' · ') || '—';
    text.appendChild(meta);
    box.appendChild(text);
    // 编号是 provider 给的（bt3:/qm5:/jy4:），手机这边不拼站点私有格式。
    if (item.id) {
      var open = document.createElement('button');
      open.className = 'small';
      open.textContent = '详情';
      open.addEventListener('click', function () { openDetail(item); });
      box.appendChild(open);
    }
    return box;
  }

  function showBusy(text) {
    state.loading = Boolean(text);
    // 只在开始读取时写这一行；加载完成后保留结果摘要，不然状态会被自己抹掉。
    if (text) $('lib-status').textContent = text;
    ['lib-go', 'lib-prev', 'lib-next', 'lib-category', 'lib-site'].forEach(function (id) { $(id).disabled = state.loading; });
  }

  async function load(page) {
    var site = siteById(state.site);
    var provider = providerFor(site);
    showBusy('读取资源列表…');
    $('lib-items').textContent = '';
    try {
      var result = await provider.catalog(state.category, page || 1, state.filters);
      state.page = Number(result.page) || (page || 1);
      var box = $('lib-items');
      if (!result.items.length) box.appendChild(phone.note('这一页没有符合条件的资源'));
      result.items.forEach(function (item) { box.appendChild(card(item)); });
      $('lib-page').textContent = '第 ' + state.page + ' 页 · ' + result.items.length + ' 条';
      $('lib-prev').disabled = state.loading || state.page <= 1;
      $('lib-next').disabled = state.loading || !result.hasNext;
      var category = (site.categories.filter(function (pair) { return pair[0] === state.category; })[0] || ['', ''])[1];
      $('lib-status').textContent = (state.filters.search ? '搜索「' + state.filters.search + '」：' : category + '：')
        + (result.hasNext ? '还有下一页' : '到底了');
    } catch (error) {
      $('lib-status').textContent = '';
      $('lib-items').appendChild(phone.note('没能读到资源列表：' + error.message));
      if (error.loginRequired) $('lib-items').appendChild(gateButton(site));
      phone.log(site.label + '读取失败：' + error.message, 'warning');
    }
    showBusy('');
  }

  // 站点要验证或要登录时，把那个入口就地给出来：不然用户只看到一句错误，不知道能做什么。
  function gateButton(site) {
    var box = document.createElement('div');
    box.className = 'row';
    var button = document.createElement('button');
    button.className = 'small';
    button.textContent = site.gate.button;
    button.addEventListener('click', function () { openGate(site); });
    box.appendChild(button);
    return box;
  }

  function openGate(site) {
    if (!site.gate) return;
    phone.log('打开 ' + site.label + ' 的' + site.gate.button + '页面…', 'info');
    window.CsStore.login({ url: site.gate.url, hint: site.gate.hint, wanted: '', storageKeys: site.gate.storageKeys || '' });
  }

  // 登录窗回来的凭据按地址认领（分发在 shell.js）：www.qmp4.com 归七味、jying.top 归聚影，
  // 115 那一份由转存面板认领。这里不再另记「谁在等」——一个站点一个域名，地址本身就是路由键。
  if (window.CsHost && window.CsHost.onLoginResult) {
    window.CsHost.onLoginResult(function (payload) {
      var result = payload || {};
      var host = hostOf(result.url || '');
      var site = null;
      SITES.forEach(function (row) { if (row.gate && hostOf(row.gate.url) === host) site = row; });
      if (!site) return false;
      if (!result.cookie) {
        renderGate(site);
        phone.log(site.label + '没有取到凭据：' + (result.error || '窗口已取消'), 'warning');
        return true;
      }
      var storage = result.storage || {};
      var patch = { cookie: result.cookie, ua: storage.__ua || '' };
      if (storage.app_user_token) {
        patch.token = storage.app_user_token;
        patch.tokenExpires = Number(storage.app_user_token_expires || 0) || Date.now() + 7 * 86400000;
      }
      saveCredential(site, patch);
      phone.log(site.label + '凭据已保存到本机（只在这台手机上）', 'success');
      renderGate(site);
      delete providers[site.id];   // 换了凭据，旧 provider 的节流与缓存意图都不作数了
      loadChoices(site).then(function () { load(1); });
      return true;
    });
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (error) { return ''; }
  }

  function seedRow(seed) {
    var line = document.createElement('div');
    line.className = 'row';
    var text = document.createElement('div');
    text.className = 'grow';
    var title = document.createElement('div');
    title.textContent = seed.zname || seed.title || seed.name || '（未命名）';
    text.appendChild(title);
    var meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = [seed.zqxd, seed.zsize, seed.ezt].filter(Boolean).join(' · ') || '大小与时间未在列表页给出';
    text.appendChild(meta);
    line.appendChild(text);
    var copy = document.createElement('button');
    copy.className = 'small';
    copy.textContent = seed.zlink && /^ed2k:/i.test(seed.zlink) ? '复制电驴' : '复制磁力';
    copy.addEventListener('click', function () { copyText(seed.zlink, '下载链接'); });
    line.appendChild(copy);
    return line;
  }

  // 站点页面里顺带列出的网盘分享（聚影、七味都给）——复制链接，或者 115 的直接送去转存页。
  function cloudRow(siteName, cloud) {
    var line = document.createElement('div');
    line.className = 'row';
    var text = document.createElement('div');
    text.className = 'grow';
    var title = document.createElement('div');
    title.textContent = cloud.seed_name || cloud.title || cloud.name || '（未命名网盘资源）';
    text.appendChild(title);
    var meta = document.createElement('div');
    meta.className = 'item-meta';
    meta.textContent = [siteName, cloud.date || cloud.dateSource, cloud.code ? '提取码 ' + cloud.code : '', cloud.size]
      .filter(Boolean).join(' · ');
    text.appendChild(meta);
    line.appendChild(text);
    var copy = document.createElement('button');
    copy.className = 'small';
    copy.textContent = '复制链接';
    copy.addEventListener('click', function () { copyText(cloud.link, '网盘链接'); });
    line.appendChild(copy);
    if (/115\.com|115cdn\.com|anxia\.com/i.test(cloud.link || '')) {
      var go = document.createElement('button');
      go.className = 'small';
      go.textContent = '去转存';
      go.addEventListener('click', function () { phone.sendToTransfer({ link: cloud.link, code: cloud.code || '' }); });
      line.appendChild(go);
    }
    return line;
  }

  // 聚影的网盘链接不在影片详情里，要再走一轮资源接口（每次请求最少隔 5 秒），
  // 所以不自动读，点一下才读；七味的站点页面直接列出了，detail 就带着。
  function lazyCloudRow(site, item) {
    var line = document.createElement('div');
    line.className = 'row';
    var text = document.createElement('div');
    text.className = 'grow';
    text.textContent = '这部影片的网盘链接要再问一次资源接口，逐条取，可能要等几秒。';
    line.appendChild(text);
    var button = document.createElement('button');
    button.className = 'small';
    button.textContent = '读取网盘链接';
    button.addEventListener('click', function () {
      button.disabled = true;
      button.textContent = '读取中…';
      providerFor(site).clouds(item.id).then(function (rows) {
        $('lib-clouds').textContent = '';
        rows.forEach(function (row) {
          $('lib-clouds').appendChild(cloudRow(site.label,
            { link: row.url, title: row.title, code: row.code, size: row.size, date: row.date }));
        });
        if (!rows.length) $('lib-clouds').appendChild(phone.note('这部影片没有列出的网盘链接'));
        phone.log(site.label + '网盘链接：' + rows.length + ' 条', 'success');
      }, function (error) {
        button.disabled = false;
        button.textContent = '读取网盘链接';
        $('lib-clouds').appendChild(phone.note('没能读取网盘链接：' + error.message));
        phone.log(site.label + '网盘链接读取失败：' + error.message, 'warning');
      });
    });
    line.appendChild(button);
    return line;
  }

  function copyText(value, label) {
    if (!value) { phone.log('这一条没有可复制的' + label, 'warning'); return; }
    window.CsStore.set('clipboard', value);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { phone.log(label + '已复制到系统剪贴板', 'success'); },
        function () { phone.log(label + '已放进应用剪贴板，系统剪贴板被浏览器拦住了', 'warning'); });
      return;
    }
    phone.log(label + '已放进应用剪贴板（这个 WebView 版本没有开放系统剪贴板）', 'warning');
  }

  async function openDetail(item) {
    var site = siteById(state.site);
    showBusy('读取详情…');
    $('lib-detail').hidden = false;
    $('lib-detail-title').textContent = item.title || '（无标题）';
    $('lib-detail-meta').textContent = '正在读取资源列表…';
    $('lib-seeds').textContent = '';
    $('lib-clouds').textContent = '';
    try {
      // allowLocked 是桌面端 jying-detail 那条路：登录态不够时照样把影片信息给出来，
      // 只是资源链接那一块换成「需要登录」加一个登录按钮。
      var detail = await providerFor(site).detail(item.id, { allowLocked: true });
      var meta = [detail.niandai || detail.year, detail.class, detail.production_area, detail.director, detail.performer]
        .filter(Boolean).join(' · ');
      $('lib-detail-meta').textContent = meta || '站点未给出更多信息';
      var seeds = detail.all_seeds || [];
      if (detail.resourceAccessRequired) {
        $('lib-seeds').appendChild(phone.note(detail.resourceMessage || '这个站点的资源链接需要登录'));
        $('lib-seeds').appendChild(gateButton(site));
      } else if (!seeds.length) {
        $('lib-seeds').appendChild(phone.note('这个页面没有列出种子'));
      }
      seeds.forEach(function (seed) { $('lib-seeds').appendChild(seedRow(seed)); });
      var clouds = [];
      Object.keys(detail.movies_online_seed || {}).forEach(function (name) {
        (detail.movies_online_seed[name] || []).forEach(function (cloud) { clouds.push([name, cloud]); });
      });
      clouds.forEach(function (pair) { $('lib-clouds').appendChild(cloudRow(pair[0], pair[1])); });
      var wantLazy = Boolean(site.lazyClouds) && !detail.resourceAccessRequired;
      $('lib-clouds-title').hidden = !clouds.length && !wantLazy;
      if (!clouds.length && wantLazy) $('lib-clouds').appendChild(lazyCloudRow(site, item));
      if (seeds.length && site.binary) {
        $('lib-seeds').appendChild(phone.note('磁力离线下载还没接到手机上：现在复制磁力链接，到 115 客户端或「转存」页处理。'));
      }
      phone.log('详情读取：' + (detail.title || item.title) + '，' + seeds.length + ' 个种子、'
        + clouds.length + ' 个网盘链接', 'success');
    } catch (error) {
      $('lib-detail-meta').textContent = '没能读到详情：' + error.message;
      if (error.loginRequired) $('lib-seeds').appendChild(gateButton(site));
      phone.log('详情读取失败：' + error.message, 'warning');
    }
    showBusy('');
    $('lib-detail').scrollIntoView({ block: 'start' });
  }

  async function loadChoices(site) {
    site = site || siteById(state.site);
    try {
      renderChoices(await providerFor(site).filters());
    } catch (error) {
      renderChoices({});
      phone.log('筛选条件没读到：' + error.message, 'warning');
    }
  }

  function siteOption(site) {
    var node = document.createElement('option');
    node.value = site.id;
    node.textContent = site.label;
    // 能力不够就别让人选中：这里按运行时依赖判，不按版本号猜。
    if (site.needs && !site.needs()) {
      node.textContent += '（' + site.needsLabel + '）';
      node.disabled = true;
    }
    return node;
  }

  function buildSites() {
    var box = $('lib-site');
    box.textContent = '';
    SITES.forEach(function (site) { box.appendChild(siteOption(site)); });
    box.value = state.site;
  }

  function buildCategories(site) {
    fill('lib-category', site.categories.map(function (pair) { return { value: pair[0], label: pair[1] }; }), state.category);
  }

  // 站点自己要不要验证/登录，以及本机存过凭据没有，都在这两行里说出来。
  function renderGate(site) {
    $('lib-verify').hidden = !site.gate;
    $('lib-verify').textContent = site.gate ? site.gate.button : '';
    $('lib-gate-state').textContent = site.gate
      ? (credential(site).cookie ? site.label + '：本机已有凭据（' + new Date(credential(site).savedAt).toLocaleString() + '）'
                                : site.label + '：未' + site.gate.button)
      : '';
  }

  function switchSite(id) {
    var site = siteById(id);
    state = current(site.id);
    buildFilterRow(site);
    buildCategories(site);
    $('lib-search').value = '';
    $('lib-detail').hidden = true;
    renderGate(site);
    window.CsStore.set('library-site', site.id);
    loadChoices(site).then(function () { load(1); });
  }

  $('lib-site').addEventListener('change', function () { switchSite(this.value); });
  $('lib-category').addEventListener('change', function () {
    state.category = this.value;
    state.filters = { search: $('lib-search').value.trim() };
    loadChoices().then(function () { load(1); });
  });
  $('lib-search').addEventListener('change', function () {
    state.filters = { search: this.value.trim() };
    renderChoices({});
    load(1);
  });
  $('lib-go').addEventListener('click', function () { state.filters = readFilters(); load(state.page); });
  $('lib-prev').addEventListener('click', function () { load(Math.max(1, state.page - 1)); });
  $('lib-next').addEventListener('click', function () { load(state.page + 1); });
  $('lib-detail-close').addEventListener('click', function () { $('lib-detail').hidden = true; });
  $('lib-verify').addEventListener('click', function () { openGate(siteById(state.site)); });

  buildSites();
  switchSite(window.CsStore.get('library-site', 'btbtla'));
})();
