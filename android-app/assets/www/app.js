// 转存面板：115 登录、选目录、扫描分享、分片转存。
// 这里只做界面与编排，接口判定全部走 cloudsave-modules.js 里那份和桌面端同源的代码。
// 标签切换与日志在 shell.js；资源库在 library.js，它不依赖这里的任何登录状态。
(function () {
  'use strict';

  var phone = window.CsPhone;
  var modules = window.CloudSave || {};
  var api = modules['share115-api.js'];
  var share115 = modules['share115-provider.js'];
  if (!phone || !api || !share115) return;

  var $ = phone.$;

  function request(url, options, cookie) { return api.requestJson(globalThis.fetch, url, options, cookie); }

  var provider = new share115.Share115Provider({
    request: request,
    check: api.check115,
    wait: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); },
  });

  var state = { cookie: '', account: null, folder: null, cid: '0', busy: false, cancel: false, scanned: null };
  var CHUNK = 50;

  function log(message, level) { phone.log(message, level); }
  var note = phone.note;
  var human = phone.human;

  function active() {
    if (state.cancel) throw new Error('已取消');
  }

  function setBusy(busy, label) {
    state.busy = busy;
    state.cancel = false;
    $('cancel').hidden = !busy;
    $('busy').textContent = busy ? (label || '处理中…') : '';
    $('login').disabled = busy;
    $('paste-save').disabled = busy;
    $('browse').disabled = busy || !state.cookie;
    $('scan').disabled = busy || !state.cookie;
    $('transfer').disabled = busy || !state.cookie || !state.folder || !state.scanned;
  }

  function renderAccount() {
    $('account').textContent = state.account
      ? state.account.nickname + '（UID ' + state.account.uid + '）'
      : state.cookie ? '凭据已保存，但读取账户失败' : '未登录';
    $('account').className = state.account ? 'ok' : 'warn';
    $('logout').hidden = !state.cookie;
  }

  function renderFolder() {
    $('folder-name').textContent = state.folder ? state.folder.name + '（cid ' + state.folder.cid + '）' : '未选择';
    $('folder-name').className = state.folder ? 'ok' : 'warn';
  }

  function renderTrail(trail) {
    var box = $('trail');
    box.textContent = '';
    trail.forEach(function (item, index) {
      if (index) box.appendChild(document.createTextNode(' / '));
      var node = document.createElement('span');
      node.textContent = item.name;
      if (index < trail.length - 1) {
        node.className = 'crumb';
        node.addEventListener('click', function () { openFolders(item.cid, trail.slice(0, index + 1)); });
      }
      box.appendChild(node);
    });
  }

  async function useCookie(raw, source) {
    var normalized = api.normalizeCookie(raw);
    var account = await api.getAccount(request, normalized);
    state.cookie = normalized;
    state.account = account;
    window.CsStore.setSecret('cookie115', normalized);
    renderAccount();
    log('已登录 115：' + account.nickname + '（' + source + '）', 'success');
    if (state.folder) {
      try { state.folder = await api.validateSaveFolder(request, state.cookie, state.folder, account.uid); }
      catch (error) { log('保存目录需要重新确认：' + error.message, 'warning'); state.folder = null; window.CsStore.set('folder115', ''); }
      renderFolder();
    }
    setBusy(false);
  }

  async function restore() {
    state.cookie = window.CsStore.secret('cookie115');
    var saved = window.CsStore.get('folder115', '');
    if (saved) { try { state.folder = JSON.parse(saved); } catch (error) { state.folder = null; } }
    renderFolder();
    if (!state.cookie) { setBusy(false); return; }
    try {
      state.account = await api.getAccount(request, state.cookie);
      window.CsStore.setSecret('cookie115', state.cookie);
    } catch (error) {
      log('读取 115 账户失败：' + error.message, 'warning');
      state.account = null;
    }
    renderAccount();
    setBusy(false);
  }

  async function openFolders(cid, trail) {
    var path = trail || [{ cid: cid, name: (state.folder && cid === state.folder.cid ? state.folder.name : '根目录') }];
    $('folder-list').textContent = '';
    $('folder-panel').hidden = false;
    renderTrail(path);
    state.cid = cid;
    try {
      var rows = await api.getFolders(request, state.cookie, cid);
      var box = $('folder-list');
      box.textContent = '';
      if (!rows.length) box.appendChild(note('这个目录下没有子目录'));
      rows.forEach(function (row) {
        var line = document.createElement('div');
        line.className = 'row';
        var name = document.createElement('span');
        name.className = 'grow';
        name.textContent = row.name;
        var enter = document.createElement('button');
        enter.className = 'small';
        enter.textContent = '进入';
        enter.addEventListener('click', function () { openFolders(row.cid, path.concat([{ cid: row.cid, name: row.name }])); });
        line.appendChild(name);
        line.appendChild(enter);
        box.appendChild(line);
      });
      $('pick-folder').disabled = false;
    } catch (error) {
      log('读取目录失败：' + error.message, 'warning');
    }
  }

  async function scan() {
    state.scanned = null;
    $('summary').textContent = '';
    var share;
    try { share = share115.parseShare($('link').value, $('code').value); }
    catch (error) { log('分享地址有问题：' + error.message, 'warning'); return; }
    if (!share) { log('这不是 115 的分享地址，第一版只支持 115.com / anxia.com / share.115.com 的分享链接', 'warning'); return; }
    setBusy(true, '扫描分享…');
    try {
      var files = await provider.list(share, state.cookie, active);
      var bytes = 0, folders = 0;
      // 目录的判定跟 share115-provider 的 inspect 保持一致：fid 为 0 且没有 file_id。
      files.forEach(function (row) {
        if (String(row.fid || '0') === '0' && !row.file_id) { folders++; return; }
        var size = Number(row.s != null ? row.s : row.file_size != null ? row.file_size : row.size);
        if (Number.isSafeInteger(size) && size > 0) bytes += size;
      });
      state.scanned = { share: share, files: files };
      $('summary').textContent = files.length + ' 个顶层条目（含 ' + folders + ' 个目录，目录内大小未计入）· 顶层文件合计 ' + human(bytes);
      log('分享可读：' + files.length + ' 个顶层条目', 'success');
    } catch (error) {
      log('扫描失败：' + error.message, 'warning');
    }
    setBusy(false);
  }

  async function transfer() {
    if (!state.scanned) return;
    var share = state.scanned.share, files = state.scanned.files;
    var verifyEnabled = $('verify').checked;
    setBusy(true, '转存中…');
    var done = 0, chunks = Math.ceil(files.length / CHUNK);
    try {
      for (var start = 0; start < files.length; start += CHUNK) {
        active();
        var account = await api.getAccount(request, state.cookie);
        if (!state.account || String(account.uid) !== String(state.account.uid)) throw new Error('115账户已更换，没有继续转存');
        state.account = account;
        var chunk = files.slice(start, start + CHUNK);
        var ids = chunk.map(function (row) { return row.id; });
        log('提交第 ' + (Math.floor(start / CHUNK) + 1) + '/' + chunks + ' 块：' + chunk.length + ' 项 → ' + state.folder.name, 'info');
        var receipt = await provider.receive(share, ids, state.folder.cid, state.cookie, verifyEnabled ? { files: chunk, active: active } : { active: active });
        done += chunk.length;
        if (receipt && receipt.verification) log('本块已核验目标目录：' + receipt.verification.checked + ' 项', 'success');
      }
      window.CsStore.set('last-transfer', JSON.stringify({ at: Date.now(), shareCode: share.shareCode, cid: state.folder.cid, count: done }));
      log('转存完成：' + done + ' 项已保存到「' + state.folder.name + '」', 'success');
      state.scanned = null;
    } catch (error) {
      log('转存未完成：' + error.message + (error.uncertain ? '（请先到目标目录核对，避免重复转存）' : ''), 'warning');
    }
    setBusy(false);
  }

  function bind() {
    $('login').addEventListener('click', function () { log('打开 115 登录页…'); window.CsStore.login(); });
    $('logout').addEventListener('click', function () {
      window.CsStore.setSecret('cookie115', '');
      state.cookie = ''; state.account = null;
      renderAccount();
      log('已清除本机保存的 115 登录凭据');
      setBusy(false);
    });
    $('paste-toggle').addEventListener('click', function () { $('paste-box').hidden = !$('paste-box').hidden; });
    $('paste-save').addEventListener('click', async function () {
      setBusy(true, '校验凭据…');
      try { await useCookie($('cookie').value, '粘贴'); $('paste-box').hidden = true; $('cookie').value = ''; }
      catch (error) { log('凭据不可用：' + error.message, 'warning'); setBusy(false); }
    });
    $('browse').addEventListener('click', function () { openFolders('0'); });
    $('close-folders').addEventListener('click', function () { $('folder-panel').hidden = true; });
    $('pick-folder').addEventListener('click', async function () {
      var current = { cid: state.cid, name: $('trail').lastChild ? $('trail').lastChild.textContent : '根目录' };
      setBusy(true, '确认目录…');
      try {
        state.folder = await api.validateSaveFolder(request, state.cookie, current, state.account.uid);
        window.CsStore.set('folder115', JSON.stringify(state.folder));
        renderFolder();
        $('folder-panel').hidden = true;
        log('保存目录：' + state.folder.name, 'success');
      } catch (error) { log('目录确认失败：' + error.message, 'warning'); }
      setBusy(false);
    });
    $('scan').addEventListener('click', function () { scan(); });
    $('transfer').addEventListener('click', function () { transfer(); });
    $('cancel').addEventListener('click', function () { state.cancel = true; log('取消请求已记下，正在当前这一步结束后停下…', 'warning'); });
  }

  // 登录窗现在有三种用途（115 登录、七味验证、聚影登录），结果按地址认领：
  // 只认 115 这几个域名，别的地址回来的 Cookie 绝不能写进 cookie115——那会把站点凭据当网盘凭据用。
  window.CsHost.onLoginResult(function (payload) {
    if (!/115\.com|115cdn\.com|anxia\.com/i.test(String((payload || {}).url || ''))) return false;
    if (!payload.cookie) {
      log(payload.error ? '登录未完成：' + payload.error : '登录窗口已取消，没有读到 115 凭据', 'warning');
      return true;
    }
    setBusy(true, '校验登录…');
    useCookie(payload.cookie, '登录窗口').catch(function (error) {
      log('登录凭据不可用：' + error.message, 'warning');
      setBusy(false);
    });
    return true;
  });

  // 只有原生层才知道的消息（例如系统密钥库退回明文）也进同一个日志。
  window.CsHost.onSystemLog = function (level, message) { log(message, level); };

  bind();
  restore();
})();
