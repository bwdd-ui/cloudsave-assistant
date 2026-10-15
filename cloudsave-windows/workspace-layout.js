// Rearrange existing controls, retaining their handlers and saved task drafts.
(() => {
  const $ = id => document.getElementById(id), nav = document.querySelector('.side-nav'), main = document.querySelector('main.main');
  const groups = [];
  let current;
  for (const node of Array.from(nav.children)) {
    if (node.classList.contains('nav-group-heading')) {
      const title = node.textContent.trim(), group = document.createElement('section');
      group.className = 'nav-group';
      const toggle = document.createElement('button'), body = document.createElement('div');
      toggle.type = 'button'; toggle.className = 'nav-group-toggle'; toggle.title = title;
      toggle.innerHTML = '<span></span><b aria-hidden="true">⌄</b>'; toggle.querySelector('span').textContent = title;
      body.className = 'nav-group-body'; body.id = 'nav-group-' + groups.length;
      toggle.setAttribute('aria-controls', body.id); toggle.setAttribute('aria-expanded', 'false'); body.hidden = true;
      toggle.onclick = () => { body.hidden = !body.hidden; toggle.setAttribute('aria-expanded', String(!body.hidden)); };
      group.append(toggle, body); node.replaceWith(group); current = { title, group, toggle, body }; groups.push(current);
    } else if (current && node.classList.contains('nav-btn')) {
      current.body.append(node);
      const label = node.querySelector('.nav-label'), full = label?.textContent.trim() || node.title;
      node.dataset.fullLabel = full; node.title = full; node.setAttribute('aria-label', full);
      if (current.title === '资源库' && label) label.textContent = full.replace(/^资源库/, '');
      if (current.title === '自动监控' && label) {
        const site = full.match(/不太灵|观影|BT影视|聚影|七味/)?.[0];
        if (site) label.textContent = site + '监控';
        else if (node.id === 'showShare115') label.textContent = '自定义网站监控';
      }
    }
  }
  const bar = document.createElement('header'); bar.className = 'workspace-bar';
  bar.innerHTML = '<div class="workspace-context"><span class="workspace-eyebrow"></span><strong class="workspace-title"></strong></div><div class="workspace-actions"><button class="btn secondary workspace-related" hidden></button><button class="btn secondary" data-workspace-nav="showOfflineTasks">离线任务</button><button class="btn secondary" data-workspace-nav="showShare115Logs">任务日志</button><button class="btn secondary" data-workspace-nav="showSettings">设置</button></div><div class="workspace-monitor-jumps" hidden><button type="button" data-monitor-jump="magnet">磁力监控</button><button type="button" data-monitor-jump="cloud">网盘任务</button><span>两套监控可分别配置和启停</span></div>';
  main.prepend(bar);
  const version = document.createElement('span'); version.className = 'workspace-version';
  version.title = '当前正在运行的程序版本'; bar.querySelector('.workspace-context').append(version);
  window.cloudsave?.runtimeVersion?.().then(value => { version.textContent = 'v' + value; }).catch(() => { version.textContent = '版本读取失败'; });
  // Keep the cloud's actual download state separate from local submission counts.
  // Move existing nodes so their values, focus and registered handlers survive.
  const historyTools = document.querySelector('#offlineHistoryPane .offline-history-tools');
  const cloudCounts = $('cloudDownloadCounts'), cloudStatus = $('cloudDownloadSyncStatus');
  if (historyTools && cloudCounts && cloudStatus) {
    const overview = document.createElement('div'), syncCard = document.createElement('section');
    overview.className = 'offline-overview'; syncCard.className = 'card offline-sync-card';
    syncCard.setAttribute('aria-labelledby', 'offline-sync-heading');
    const syncHeading = document.createElement('h2');
    syncHeading.id = 'offline-sync-heading'; syncHeading.textContent = '115 云下载状态与同步';
    const historyHeading = document.createElement('h2'); historyHeading.textContent = '本地提交记录';
    const controls = $('cloudSyncEnabled')?.closest('.row');
    syncCard.append(syncHeading, cloudCounts);
    if (controls) { controls.classList.add('offline-sync-controls'); syncCard.append(controls); }
    syncCard.append(cloudStatus); cloudStatus.setAttribute('role', 'status');
    historyTools.prepend(historyHeading); historyTools.before(overview);
    overview.append(historyTools, syncCard);
    const cloudFilterLabel = $('submitHistoryStatusFilter')?.closest('label');
    if (cloudFilterLabel?.firstChild?.nodeType === Node.TEXT_NODE) cloudFilterLabel.firstChild.textContent = '提交结果';
  }
  const episodeCard = $('offlineEpisodeSave')?.closest('.card');
  if (episodeCard) {
    const disclosure = document.createElement('details'), summary = document.createElement('summary');
    disclosure.className = 'offline-episode-disclosure';
    summary.textContent = '电视剧逐集大小检查与设置';
    episodeCard.before(disclosure); disclosure.append(summary, episodeCard);
  }
  bar.querySelectorAll('[data-workspace-nav]').forEach(button => button.onclick = () => $(button.dataset.workspaceNav)?.click());
  const pairs = [
    ['不太灵', 'showCloudHome', 'showMonitorFilter', 'filterPage'],
    ['观影', 'showGuanyingLibrary', 'showGuanyingMonitor', 'guanyingMonitorPage'],
    ['BT影视', 'showBtbtlaLibrary', 'showBtbtlaMonitor', 'btbtlaMonitorPage'],
    ['聚影', 'showJyingLibrary', 'showJyingMonitor', 'jyingMonitorPage'],
    ['七味', 'showQmp4Library', 'showQmp4Monitor', 'qmp4MonitorPage']
  ];
  let activeId = '', lastPage = 'showCloudHome';
  const settings = $('showSettings'), openSettings = settings?.onclick;
  if (settings) settings.onclick = event => {
    const previous = nav.querySelector('.nav-btn.active'); if (previous && previous !== settings) lastPage = previous.id;
    return openSettings?.call(settings, event);
  };
  const closeSettings = $('closeSettings'); if (closeSettings) closeSettings.onclick = () => $(lastPage)?.click();
  function update() {
    const active = nav.querySelector('.nav-btn.active'); if (!active) return;
    const changed = active.id !== activeId; activeId = active.id;
    const group = groups.find(item => item.body.contains(active));
    if (changed) for (const item of groups) { item.body.hidden = item !== group; item.toggle.setAttribute('aria-expanded', String(item === group)); }
    for (const button of nav.querySelectorAll('.nav-btn')) {
      if (button === active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    const pair = pairs.find(item => item[1] === activeId || item[2] === activeId), isMonitor = pair && pair[2] === activeId;
    bar.querySelector('.workspace-eyebrow').textContent = group?.title || '云存助手';
    bar.querySelector('.workspace-title').textContent = pair ? pair[0] + (isMonitor ? ' · 自动监控' : ' · 资源库') : active.dataset.fullLabel || active.textContent.trim();
    const related = bar.querySelector('.workspace-related'); related.hidden = !pair;
    if (pair) { related.textContent = isMonitor ? '浏览资源' : '自动监控'; related.onclick = () => $(pair[isMonitor ? 1 : 2])?.click(); }
    bar.querySelector('.workspace-monitor-jumps').hidden = !isMonitor;
    for (const button of bar.querySelectorAll('[data-workspace-nav]')) button.disabled = button.dataset.workspaceNav === activeId;
  }
  bar.querySelectorAll('[data-monitor-jump]').forEach(button => button.onclick = () => {
    const pair = pairs.find(item => item[2] === activeId); if (!pair) return;
    const page = $(pair[3]), target = button.dataset.monitorJump === 'cloud' ? page.querySelector('#share115Page') : page.querySelector('.monitor-unified');
    if (!target) return;
    page.scrollTo({ top: Math.max(0, page.scrollTop + target.getBoundingClientRect().top - page.getBoundingClientRect().top - 16), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  });
  new MutationObserver(update).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] }); update();
  // Preserve every filter input and event listener inside a compact disclosure.
  const filterRoots = [document.querySelector('#filterPage .filter-panel'), ...['gyMonitorFilters', 'btMonitorFilters', 'jyMonitorFilters', 'qmMonitorFilters'].map($)];
  for (const root of filterRoots) {
    if (!root) continue;
    const disclosure = document.createElement('details'), summary = document.createElement('summary');
    disclosure.className = 'monitor-native-disclosure'; summary.textContent = '网站筛选条件';
    disclosure.append(summary); root.before(disclosure); disclosure.append(root);
    const describe = () => {
      const selected = [...root.querySelectorAll('select')].filter(input => input.value && !['uptime', 'time'].includes(input.value)).length + root.querySelectorAll('.active[data-gy-option]:not([data-gy-option=""]),.active[data-bt-value]:not([data-bt-value=""]),.active[data-filter-value]:not([data-filter-value=""]):not([data-filter-group="sort"])').length;
      summary.textContent = '网站筛选条件' + (selected ? ' · 已选择 ' + selected + ' 项' : ' · 点击展开');
    };
    root.addEventListener('change', describe); root.addEventListener('click', () => queueMicrotask(describe));
    new MutationObserver(describe).observe(root, { childList: true, subtree: true }); describe();
  }
  for (const [, , , id] of pairs) {
    const page = $(id), host = page?.querySelector('.filter-shell'); if (!host) continue;
    const heading = host.querySelector(':scope > .filter-page-head'); if (heading) host.prepend(heading);
    const collection = host.querySelector('input[id$="ScanOnly"]')?.closest('.card');
    const filters = host.querySelector('.monitor-native-disclosure') || host.querySelector('.monitor-unified');
    if (collection && filters) filters.after(collection);
  }
})();
