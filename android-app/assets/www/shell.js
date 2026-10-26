// 手机端的共享外壳：标签切换、运行日志、页脚版本。
// 各面板（转存、资源库）只通过 window.CsPhone 用这里的工具，避免每个面板各写一份日志。
(function () {
  'use strict';

  // host.js 判定 WebView 太旧时会直接返回，这时 CsStore 还没有，后面的每个调用都会抛。
  if (!window.CsStore) return;

  function $(id) { return document.getElementById(id); }
  var logBox = $('log');

  function log(message, level) {
    window.CsStore.log(level || 'info', message);
    var line = document.createElement('div');
    line.className = 'line ' + (level || 'info');
    line.textContent = new Date().toLocaleTimeString() + '  ' + message;
    logBox.appendChild(line);
    while (logBox.children.length > 200) logBox.removeChild(logBox.firstChild);
    logBox.scrollTop = logBox.scrollHeight;
  }

  function note(text) {
    var div = document.createElement('div');
    div.className = 'note';
    div.textContent = text;
    return div;
  }

  function human(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return (bytes / Math.pow(1024, index)).toFixed(index ? 2 : 0) + ' ' + units[index];
  }

  var panels = { library: $('panel-library'), transfer: $('panel-transfer') };

  function switchTab(name) {
    if (!panels[name]) name = 'library';
    Object.keys(panels).forEach(function (key) { panels[key].hidden = key !== name; });
    Object.keys(panels).forEach(function (key) { $('tab-' + key).classList.toggle('active', key === name); });
    window.CsStore.set('tab', name);
  }

  window.CsPhone = {
    $: $,
    log: log,
    note: note,
    human: human,
    switchTab: switchTab,
    // 资源库里点「去转存」时把内容带到转存页，省一次手动复制粘贴。
    sendToTransfer: function (fields) {
      Object.keys(fields).forEach(function (id) { var box = $(id); if (box) box.value = fields[id]; });
      switchTab('transfer');
    },
  };

  $('tab-library').addEventListener('click', function () { switchTab('library'); });
  $('tab-transfer').addEventListener('click', function () { switchTab('transfer'); });
  $('clear-log').addEventListener('click', function () { logBox.textContent = ''; });

  var info = window.CsStore.info();
  $('about').textContent = '云存助手 手机独立版 ' + (info.version || '?')
    + ' · WebView ' + (info.webview || '?') + ' · ' + (info.os || '?');

  switchTab(window.CsStore.get('tab', 'library'));
})();
