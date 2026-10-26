// 资源库面板：浏览资源网站，不需要任何网盘登录。
// 站点解析用的是桌面端同一份 btbtla-provider.js（打包在 cloudsave-modules.js 里），
// 这里只补两个注入点：请求走原生桥，HTML 解析走 WebView 自带的 DOMParser。
(function () {
  'use strict';

  var phone = window.CsPhone;
  var modules = window.CloudSave || {};
  var btbtla = modules['btbtla-provider.js'];
  if (!phone || !btbtla) return;

  var $ = phone.$;
  var CATEGORIES = { mv: '电影', tv: '剧集', updates: '最新上传' };
  var FILTER_FIELDS = [['genre', '类型'], ['region', '地区'], ['year', '年份'], ['sort', '排序']];

  var state = { category: 'mv', page: 1, filters: {}, choices: null, detail: null, loading: false };

  // 桌面端在主进程里用一个隐藏 BrowserWindow 解析 HTML，因为 Node 没有 DOMParser；
  // WebView 本来就有，所以这里直接原地解析，不再需要那层壳。
  function parseHtml(html, kind, url) { return btbtla.extractHtml(html, kind, url); }

  function fetchHtml(url, binary) {
    if (binary) return Promise.reject(new Error('手机端还不能读取 .torrent 文件本体（原生桥目前只回文本），这一版只列站点给出的磁力链接'));
    return globalThis.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml' } })
      .then(function (response) {
        if (!response.ok) throw new Error('BT影视读取失败（' + response.status + '）');
        return response.text();
      });
  }

  // 目录结果缓存到本机：手机上一次请求比桌面贵，翻页往返回答更快；存不下就当没缓存。
  var cache = {
    get: function (key, ttl) {
      var raw = window.CsStore.get('cache:' + key, '');
      if (!raw) return null;
      try {
        var hit = JSON.parse(raw);
        return (Date.now() - hit.at < ttl) ? hit.value : null;
      } catch (error) { return null; }
    },
    set: function (key, value) {
      try { window.CsStore.set('cache:' + key, JSON.stringify({ at: Date.now(), value: value })); }
      catch (error) { phone.log('资源库缓存写不下了，这次只留在内存里', 'warning'); }
    },
  };
  var memory = new Map();
  var provider = new btbtla.BtbtlaProvider({
    fetchHtml: fetchHtml,
    parseHtml: parseHtml,
    getInterval: function () { return 3000; },
    diskCache: {
      get: function (key, ttl) { return memory.has(key) ? memory.get(key) : cache.get(key, ttl); },
      set: function (key, value) { memory.set(key, value); if (memory.size > 40) memory.delete(memory.keys().next().value); cache.set(key, value); },
    },
  });

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

  function choicesOf(key) {
    var rows = (state.choices && state.choices[key]) || [];
    return key === 'sort'
      ? [{ value: 'uptime', label: '最新上线' }].concat(rows.filter(function (row) { return row.value !== 'uptime'; }))
      : rows;
  }

  function renderChoices(choices) {
    state.choices = choices;
    var keep = {};
    FILTER_FIELDS.forEach(function (field) { keep[field[0]] = $(field[0]) ? state.filters[field[0]] : undefined; });
    FILTER_FIELDS.forEach(function (pair) {
      var box = $('lib-' + pair[0]);
      if (!box) return;
      var rows = choices[pair[0]] || [];
      fill('lib-' + pair[0], [{ value: '', label: rows.length ? '全部' : '网站未提供' }].concat(rows), keep[pair[0]] || '');
      box.disabled = !rows.length;
    });
  }

  function readFilters() {
    var filters = { search: $('lib-search').value.trim() };
    FILTER_FIELDS.forEach(function (pair) {
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
    meta.textContent = [item.year, item.genre, item.score, item.size, item.date].filter(Boolean).join(' · ') || '—';
    text.appendChild(meta);
    box.appendChild(text);
    if (item.path) {
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
      $('lib-status').textContent = (state.filters.search ? '搜索「' + state.filters.search + '」：' : CATEGORIES[state.category] + '：')
        + (result.hasNext ? '还有下一页' : '到底了');
    } catch (error) {
      $('lib-status').textContent = '';
      $('lib-items').appendChild(phone.note('没能读到资源列表：' + error.message));
      phone.log('资源库读取失败：' + error.message, 'warning');
    }
    showBusy('');
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
    copy.textContent = '复制磁力';
    copy.addEventListener('click', function () { copyText(seed.zlink, '磁力链接'); });
    line.appendChild(copy);
    if (seed.webUrl || seed.detailPath) {
      var open = document.createElement('button');
      open.className = 'small';
      open.textContent = '原页';
      open.addEventListener('click', function () { copyText('https://www.btbtla.com' + (seed.detailPath || ''), '网页地址'); });
      line.appendChild(open);
    }
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
    showBusy('读取详情…');
    $('lib-detail').hidden = false;
    $('lib-detail-title').textContent = item.title || '（无标题）';
    $('lib-detail-meta').textContent = '正在读取种子列表…';
    $('lib-seeds').textContent = '';
    try {
      var detail = await provider.detail('bt3:' + (item.seed ? 'seed' : (state.category === 'tv' ? 'tv' : 'mv')) + ':' + item.siteId);
      var seeds = detail.all_seeds || [];
      $('lib-detail-meta').textContent = [detail.niandai || detail.year, detail.class, detail.production_area, detail.director]
        .filter(Boolean).join(' · ') || '站点未给出更多信息';
      if (!seeds.length) $('lib-seeds').appendChild(phone.note('这个页面没有列出种子'));
      seeds.forEach(function (seed) { $('lib-seeds').appendChild(seedRow(seed)); });
      $('lib-detail').appendChild(phone.note('磁力离线下载还没接到手机上：现在复制磁力链接，到 115 客户端或「转存」页处理。'));
      phone.log('详情读取：' + (detail.title || item.title) + '，' + seeds.length + ' 个种子', 'success');
    } catch (error) {
      $('lib-detail-meta').textContent = '没能读到详情：' + error.message;
      phone.log('详情读取失败：' + error.message, 'warning');
    }
    showBusy('');
    $('lib-detail').scrollIntoView({ block: 'start' });
  }

  async function loadChoices() {
    try {
      renderChoices(await provider.filters());
    } catch (error) {
      renderChoices({ genre: [], region: [], year: [], sort: [] });
      phone.log('筛选条件没读到：' + error.message, 'warning');
    }
  }

  $('lib-category').addEventListener('change', function () {
    state.category = this.value;
    state.filters = { search: '' };
    $('lib-search').value = '';
    loadChoices().then(function () { load(1); });
  });
  FILTER_FIELDS.forEach(function (pair) {
    var box = $('lib-' + pair[0]);
    if (box) box.addEventListener('change', function () { state.filters[pair[0]] = this.value; load(1); });
  });
  $('lib-search').addEventListener('change', function () { state.filters = { search: this.value.trim() }; renderChoices({ genre: [], region: [], year: [], sort: [] }); load(1); });
  $('lib-go').addEventListener('click', function () { state.filters = readFilters(); load(state.page); });
  $('lib-prev').addEventListener('click', function () { load(Math.max(1, state.page - 1)); });
  $('lib-next').addEventListener('click', function () { load(state.page + 1); });
  $('lib-detail-close').addEventListener('click', function () { $('lib-detail').hidden = true; });

  loadChoices();
  load(1);
})();
