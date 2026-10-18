const $ = id => document.getElementById(id);
let siteBase = 'https://www.0bt0.com';
function applyMirrorState(state, navigate = false) {
  const previous = siteBase; siteBase = state.current;
  $('mirrorSelect').innerHTML = state.sites.map(origin => `<option value="${origin}">${new URL(origin).hostname}</option>`).join('');
  $('mirrorSelect').value = siteBase; $('mirrorAuto').checked = state.autoSwitch;
  $('mirrorStatus').textContent = `当前：${new URL(siteBase).hostname} · ${state.autoSwitch ? '自动切换已开启' : '手动模式'}`;
  if (navigate && previous !== siteBase) status(`已切换至 ${new URL(siteBase).hostname}`);
}
window.cloudsave.onMirrorStatus(state => applyMirrorState(state, true));
$('mirrorSelect').onchange = async () => { try { applyMirrorState(await window.cloudsave.setMirror($('mirrorSelect').value, $('mirrorAuto').checked), true); } catch(error) { status(error.message, true); } };
$('mirrorAuto').onchange = async () => { try { applyMirrorState(await window.cloudsave.setMirror(siteBase, $('mirrorAuto').checked)); } catch(error) { status(error.message, true); } };
$('mirrorCheck').onclick = async () => {
  const button = $('mirrorCheck'); button.disabled = true; $('mirrorStatus').textContent = '正在检查镜像，每个镜像最多等待8秒…';
  try { applyMirrorState(await window.cloudsave.checkMirrors(), true); } catch(error) { $('mirrorStatus').textContent = error.message; } finally { button.disabled = false; }
};
window.cloudsave.mirrorState().then(state => applyMirrorState(state, true)).catch(error => status(error.message, true));

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const button = $('toggleSidebar');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
  button.title = collapsed ? '展开侧栏' : '收起侧栏';
  document.querySelectorAll('.side-nav .nav-btn').forEach(item => { item.title = item.dataset.fullLabel || item.querySelector('.nav-label')?.textContent || ''; });
  try { localStorage.setItem('sidebarCollapsed', String(collapsed)); } catch (_) {}
}
$('toggleSidebar').onclick = () => setSidebarCollapsed(!document.body.classList.contains('sidebar-collapsed'));
try { setSidebarCollapsed(localStorage.getItem('sidebarCollapsed') === 'true'); } catch (_) {}
function status(text, error = false) { $('status').textContent = text; $('status').style.color = error ? '#c23939' : '#667085'; }
function log(text) { $('log').textContent = `${new Date().toLocaleTimeString()}  ${text}\n${$('log').textContent}`; }
function showAccount(account) { $('account').textContent = account?.nickname ? `${account.nickname}` : '尚未登录'; }
async function refreshState() { const state = await window.cloudsave.state(); $('folder').textContent = `${state.folder?.name || '根目录'}${state.folder?.requiresReselect ? ' · 账户已更换，请重新选择' : ''}`; if (state.folder?.cid != null) { $('folders').innerHTML = `<option value="${escapeHtml(String(state.folder.cid))}">${escapeHtml(state.folder.name || '根目录')}</option>`; } if (state.cookie) { status('已保存 115 登录状态，可自动恢复会话'); try { showAccount(await window.cloudsave.account()); } catch (_) {} } }
const filterIdToGroup = { monitorGenres: 'genres', monitorCountries: 'countries', monitorYears: 'years', monitorQualities: 'qualities', monitorTags: 'tags' };
function selectedValues(id) { const group = filterIdToGroup[id] || id; return [...document.querySelectorAll(`[data-filter-group="${group}"].active`)].map(button => button.dataset.filterValue).filter(Boolean); }
function customValues(id) { return String($(id)?.value || '').split(/[、,，\/|]+/).map(value => value.trim()).filter(Boolean); }
function mergeFilterValues(selectId, customId) { return [...new Set([...selectedValues(selectId), ...customValues(customId)])]; }
function setSelectedValues(id, values) { const group = filterIdToGroup[id] || id; const wanted = new Set(values || []); document.querySelectorAll(`[data-filter-group="${group}"]`).forEach(button => { const value = button.dataset.filterValue; button.classList.toggle('active', value ? wanted.has(value) : !wanted.size); }); }
function setCustomValues(selectId, inputId, values) { const group = filterIdToGroup[selectId] || selectId; const options = new Set([...document.querySelectorAll(`[data-filter-group="${group}"]`)].map(button => button.dataset.filterValue).filter(Boolean)); $(inputId).value = (values || []).filter(value => !options.has(value)).join(', '); }
function updateMonitorFilterHint(filters = {}) { const count = ['genres', 'countries', 'years', 'qualities', 'tags'].reduce((sum, key) => sum + (filters[key]?.length || 0), 0); const extras = (filters.onlyImdb ? 1 : 0) + (filters.onlyCloud ? 1 : 0) + (filters.scoreRange ? 1 : 0); return count + extras ? `已设置 ${count + extras} 项筛选，排序：${filters.sort || '更新时间'}` : '未设置筛选，监控全部新磁力'; }
function applyMonitorFilters(filters = {}) { const modes=(filters.saveModes||['movie','tv']).join(',');document.querySelectorAll('[data-save-modes]').forEach(b=>b.classList.toggle('active',b.dataset.saveModes===modes)); setSelectedValues('monitorGenres', filters.genres); setSelectedValues('monitorCountries', filters.countries); setSelectedValues('monitorYears', filters.years); setSelectedValues('monitorQualities', filters.qualities); setSelectedValues('monitorTags', filters.tags); setCustomValues('monitorGenres', 'monitorGenresCustom', filters.genres); setCustomValues('monitorCountries', 'monitorCountriesCustom', filters.countries); setCustomValues('monitorYears', 'monitorYearsCustom', filters.years); setCustomValues('monitorQualities', 'monitorQualitiesCustom', filters.qualities); setCustomValues('monitorTags', 'monitorTagsCustom', filters.tags); setSelectedValues('sort', [filters.sort || '更新时间']); setSelectedValues('scoreRange', [filters.scoreRange || '']); $('monitorOnlyImdb').checked = Boolean(filters.onlyImdb); $('monitorOnlyCloud').checked = Boolean(filters.onlyCloud); $('monitorCompareSize').checked = filters.compareSize !== false; $('monitorMinSize').value = filters.sizeRanges?.movie?.minSizeGB ?? filters.minSizeGB ?? ''; $('monitorMaxSize').value = filters.sizeRanges?.movie?.maxSizeGB ?? filters.maxSizeGB ?? ''; $('monitorTvMinSize').value=filters.sizeRanges?.tv?.minSizeGB ?? filters.minSizeGB ?? ''; $('monitorTvMaxSize').value=filters.sizeRanges?.tv?.maxSizeGB ?? filters.maxSizeGB ?? ''; $('monitorWithinDays').value = filters.withinDays || ''; $('monitorWithinMinutes').value=filters.withinMinutes||60; $('monitorDateMode').value = filters.dateMode || 'recent'; $('monitorStartDate').value = filters.startDate || ''; $('monitorEndDate').value = filters.endDate || ''; updateMonitorDateInputs(); $('monitorMaxItems').value = filters.maxItems || 30; }
function updateMonitorDateInputs() { const range = $('monitorDateMode').value === 'range'; $('monitorRecentDates').hidden = $('monitorDateMode').value!=='recent'; $('monitorMinuteDates').hidden=$('monitorDateMode').value!=='minutes'; $('monitorRangeDates').hidden = !range; }
function readMonitorFilters() { return { saveModes:(document.querySelector('[data-save-modes].active')?.dataset.saveModes||'movie,tv').split(','), genres: mergeFilterValues('monitorGenres', 'monitorGenresCustom'), countries: mergeFilterValues('monitorCountries', 'monitorCountriesCustom'), years: mergeFilterValues('monitorYears', 'monitorYearsCustom'), qualities: mergeFilterValues('monitorQualities', 'monitorQualitiesCustom'), tags: mergeFilterValues('monitorTags', 'monitorTagsCustom'), sort: selectedValues('sort')[0] || '更新时间', scoreRange: selectedValues('scoreRange')[0] || '', onlyImdb: $('monitorOnlyImdb').checked, onlyCloud: $('monitorOnlyCloud').checked, compareSize: $('monitorCompareSize').checked, sizeRanges:{movie:{minSizeGB:$('monitorMinSize').value,maxSizeGB:$('monitorMaxSize').value},tv:{minSizeGB:$('monitorTvMinSize').value,maxSizeGB:$('monitorTvMaxSize').value}}, minSizeGB: Number($('monitorMinSize').value) || 0, maxSizeGB: Number($('monitorMaxSize').value) || 0, withinDays: Number($('monitorWithinDays').value) || 0, withinMinutes:Number($('monitorWithinMinutes').value), dateMode: $('monitorDateMode').value, startDate: $('monitorStartDate').value, endDate: $('monitorEndDate').value, maxItems: Number($('monitorMaxItems').value) || 30 }; }
let monitorFiltersDirty = false;
let appliedMonitorFiltersSignature = '';
let lastMonitorEnabled;
let lastMonitorInterval;
function showMonitor(state) {
  if (!state) return;
  if($('stopMonitor'))$('stopMonitor').disabled=!state.running;
  if($('btlScanOnly')){$('btlScanOnly').checked=Boolean(state.scanOnly);$('monitorAutoSubmit').disabled=Boolean(state.scanOnly);}
  if($('monitorAutoSubmit') && document.activeElement!==$('monitorAutoSubmit'))$('monitorAutoSubmit').checked=state.autoSubmit!==false;
  const enabled = Boolean(state.enabled); const interval = state.intervalMinutes || 15;
  if (enabled !== lastMonitorEnabled && document.activeElement !== $('monitorEnabled')) { $('monitorEnabled').checked = enabled; lastMonitorEnabled = enabled; }
  if (interval !== lastMonitorInterval && document.activeElement !== $('monitorInterval')) { $('monitorInterval').value = interval; lastMonitorInterval = interval; }
  const signature = JSON.stringify(state.filters || {});
  if (signature !== appliedMonitorFiltersSignature && !monitorFiltersDirty) { applyMonitorFilters(state.filters || {}); appliedMonitorFiltersSignature = signature; }
  $('monitorStatus').textContent = state.running ? state.lastMessage : `${enabled ? '监控已开启' : '监控未开启'}：${state.lastMessage || ''}${state.lastRun ? `\n上次检查：${new Date(state.lastRun).toLocaleString()}` : ''}`;
  if(!state.running && enabled)$('monitorStatus').textContent += state.filterBlockedSignature ? '\n资源扫描暂停，网站筛选恢复后自动继续。'+(state.nextFilterProbeAt?'下次轻量复查：'+new Date(state.nextFilterProbeAt).toLocaleString():'即将自动复查。')+(state.filterProbeLastAt?'\n上次筛选复查：'+new Date(state.filterProbeLastAt).toLocaleString():'') : state.nextRetryAt ? '\n网络退避至：'+new Date(state.nextRetryAt).toLocaleString() : state.nextCheckAt ? '\n下次定时检查：'+new Date(state.nextCheckAt).toLocaleString() : '';
  if (logAutoRefresh && $('logPage').style.display === 'flex') renderMonitorLogs(state.logs || []);
  if ($('filterPage').style.display === 'block') renderCoverageReview(state.coverageReview || []);
}
function renderCoverageReview(rows) {
  const target=$('coverageReview');if(!target)return;
  target.innerHTML=rows.length ? '<details><summary>集数或文件信息待检查（'+rows.length+'条）</summary><p>这些资源已尝试读取详情。这不是离线失败数量。文件集号或逐集大小未确认时保留提示，避免遗漏剧集；无法判断的资源不会假定为已覆盖。</p>'+rows.map(row=>'<article class="coverage-review-row"><strong>'+escapeHtml(row.movieTitle || row.title)+'</strong><div>'+escapeHtml(row.title)+'</div><p>'+escapeHtml(row.reason)+'</p><button class="btn secondary coverage-open" data-original="'+escapeHtml(row.originalUrl || 'https://www.0bt0.com/mv/'+row.movieId+'.html')+'">查看原网页</button><button class="btn secondary coverage-retry" data-url="'+escapeHtml(row.url)+'">重新检查文件清单</button><button class="btn secondary coverage-copy" data-url="'+escapeHtml(row.url)+'">复制磁力</button></article>').join('')+'</details>' : '';
  target.querySelectorAll('.coverage-open').forEach(button=>button.onclick=()=>window.cloudsave.openOriginal(button.dataset.original));
  target.querySelectorAll('.coverage-retry').forEach(button=>button.onclick=async()=>{button.disabled=true;try{showMonitor(await window.cloudsave.retryCoverageReview(button.dataset.url));status('文件清单已重新检查，后续立即检查将使用新的结果');}catch(error){status(error.message,true);}finally{button.disabled=false;}});
  target.querySelectorAll('.coverage-copy').forEach(button=>button.onclick=async()=>{await navigator.clipboard.writeText(button.dataset.url);button.textContent='已复制';});
}
function markMonitorFiltersDirty(event) { if (event.target.closest('.filter-chip') || event.target.closest('.monitor-limits') || event.target.closest('.filter-panel')) monitorFiltersDirty = true; }
$('filterPage').addEventListener('input', markMonitorFiltersDirty);
$('filterPage').addEventListener('change', markMonitorFiltersDirty);
$('filterPage').addEventListener('click', markMonitorFiltersDirty);

let logAutoRefresh = true;
let logAtBottom = true;
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function formatLogTimestamp(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value || ''); const pad = number => String(number).padStart(2, '0'); const ms = String(date.getMilliseconds()).padStart(3, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}`; }
function sourceClass(source) { return `source-${String(source).replace(/[^a-z0-9_-]/gi, '').slice(0, 18) || 'default'}`; }
let recentMonitorLogs = [];
if ($('logWebsiteFilter')) $('logWebsiteFilter').onchange = () => renderMonitorLogs(recentMonitorLogs);
if ($('logLevelFilter')) $('logLevelFilter').onchange = () => renderMonitorLogs(recentMonitorLogs);
if ($('logSearch')) $('logSearch').oninput = () => { $('clearLogSearch').disabled=!$('logSearch').value; renderMonitorLogs(recentMonitorLogs); };
if ($('clearLogSearch')) $('clearLogSearch').onclick=()=>{ $('logSearch').value=''; $('clearLogSearch').disabled=true; renderMonitorLogs(recentMonitorLogs); $('logSearch').focus(); };
function renderMonitorLogs(logs = []) {
  recentMonitorLogs = Array.isArray(logs)?logs:[];
  const query=$('logSearch')?.value||'';
  $('clearLogSearch').disabled=!query;
  logs=window.cloudsaveMonitorLogSearch.filterLogs(recentMonitorLogs,{website:$('logWebsiteFilter')?.value||'all',level:$('logLevelFilter')?.value||'all',query});
  const count=$('logFilterStatus');
  if(count)count.textContent=query||$('logWebsiteFilter')?.value!=='all'||$('logLevelFilter')?.value!=='all'?`匹配 ${logs.length} / 最近 ${recentMonitorLogs.length} 条日志`:`实时显示最近${recentMonitorLogs.length}条；下载包含今天完整日志`;
  const list = $('monitorLogList');
  if (!list) return;
  if (!logs.length) { list.innerHTML = recentMonitorLogs.length?'<div class="empty">没有匹配日志，请调整网站、级别或关键词</div>':'<div class="empty">暂无监控日志</div>'; return; }
  list.innerHTML = logs.slice().reverse().map(item => { const source = item.source || 'cloudsave_monitor'; const levelName = String(item.level || 'info').toLowerCase(); const level = levelName.toUpperCase(); const detail = item.details ? `\n${item.details}` : ''; return `<div class="log-row ${levelName}"><span class="log-time">${escapeHtml(formatLogTimestamp(item.time))}</span><span class="log-source ${sourceClass(source)}">${escapeHtml((item.website==="share115"?"115分享监控":item.website==="123"?"123云盘":item.website==="qmp4"?"七味":item.website==="jying"?"聚影":item.website==="btbtla"?"BT影视":item.website==="115"?"115云下载":item.website === "guanying" || source === "guanying_monitor" ? "观影" : "不太灵") + " · " + source)}</span><span class="log-level ${levelName}">${level}</span><span class="log-icon">▧</span><span class="log-message">${escapeHtml(`${item.message || ''}${detail}`)}</span></div>`; }).join('');
  if (logAtBottom) list.scrollTop = 0; else $('newLog').style.display = 'block';
}
function setNavActive(id) { document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.id === id)); }
function hideContentPages() { window.cloudsave.haisouView?.({visible:false}); for (const id of ['share115Page','pan123Page','guanyingLibraryPage','guanyingMonitorPage','btbtlaLibraryPage','btbtlaMonitorPage','jyingLibraryPage','jyingMonitorPage','qmp4LibraryPage','qmp4MonitorPage','haisouPage']) if ($(id)) $(id).style.display='none'; $('offlineTasksPage').style.display = 'none'; $('cloudHomePage').style.display = 'none'; $('settingsPage').style.display = 'none'; $('filterPage').style.display = 'none'; $('logPage').style.display = 'none'; }
let cloudModuleReady = false;
let cloudMode = 'movie';
let cloudPage = 1;
let cloudPages = 1;
let cloudMovies = [];
let cloudPanResults = [];
let cloudPanType = '';
let cloudFilterState = {};
let cloudSearchQuery = '';
let librarySearchHistory = [];
function renderSearchHistory() { $('librarySearchHistory').innerHTML = librarySearchHistory.map(query => '<option value="'+escapeHtml(query)+'"></option>').join(''); }
async function rememberLibrarySearch(query) { librarySearchHistory = [query,...librarySearchHistory.filter(value=>value !== query)].slice(0,80); renderSearchHistory(); await window.cloudsave.setLibraryPreferences({searchHistory:librarySearchHistory}); }
function applyPosterSize(value) { const width = Math.max(100,Math.min(220,Number(value)||130)); $('posterSize').value = width; $('posterSizeValue').textContent = width+'px'; $('cloudLibraryGrid').style.setProperty('--poster-width', width+'px'); }
$('posterSize').oninput = () => applyPosterSize($('posterSize').value);
$('posterSize').onchange = () => window.cloudsave.setLibraryPreferences({posterWidth:$('posterSize').value}).catch(error=>status(error.message,true));
window.cloudsave.libraryPreferences().then(preferences=>{librarySearchHistory=preferences.searchHistory || [];renderSearchHistory();applyPosterSize(preferences.posterWidth);}).catch(error=>status(error.message,true));
function jumpLibraryPage() { if(cloudLibraryLoading)return;const page=Number($('cloudJumpPage').value); if(!Number.isInteger(page)||page<1||page>cloudPages){$('cloudLibraryStatus').textContent='请输入1至'+cloudPages+'之间的整数页码';return;} cloudPage=page;loadCloudLibrary(); }
$('cloudJump').onclick=jumpLibraryPage;
$('cloudJumpPage').onkeydown=event=>{if(event.key==='Enter')jumpLibraryPage();};
function posterUrl(value) { const raw = String(value || '').trim(); if (!raw) return ''; if (/^https?:/i.test(raw)) return raw.replace(/^http:/i, 'https:').replace(/^https:\/\/www\.[0-9]bt0\.com(?=\/|$)/i, siteBase); return `${siteBase}/${raw.replace(/^\/+/, '')}`; }
let libraryResumePane='cloudLibraryPane';
function cloudTab(name) { if(name==='cloudLibraryPane'||name==='cloudDetailPane')libraryResumePane=name; ['cloudLibraryPane', 'cloudPanPane', 'cloudSettingsPane', 'cloudDetailPane'].forEach(id => { const node = $(id); if (node) node.style.display = id === name ? 'block' : 'none'; }); ['cloudTabLibrary', 'cloudTabPan', 'cloudTabSettings'].forEach(id => $(id)?.classList.toggle('active', id === ({ cloudLibraryPane: 'cloudTabLibrary', cloudPanPane: 'cloudTabPan', cloudSettingsPane: 'cloudTabSettings' }[name] || ''))); }
function renderCloudLibrary() { const grid = $('cloudLibraryGrid'); if (!grid) return; $('cloudJumpPage').value = cloudPage; $('cloudJumpPage').max = cloudPages; $('cloudPageLabel').textContent = `${cloudPage} / ${cloudPagesKnown?cloudPages:"…"}`; $('cloudPrev').disabled = cloudPage <= 1; $('cloudNext').disabled = cloudPage >= cloudPages; if (!cloudMovies.length) { grid.innerHTML = '<div class="cloud-module-status">暂无资源</div>'; return; } grid.innerHTML = cloudMovies.map(movie => { const poster = posterUrl(movie.poster); const score = Number(movie.score || 0); return `<article class="cloud-poster-card" data-cloud-id="${escapeHtml(movie.id)}"><div class="cloud-poster">${poster ? `<img data-poster-url="${escapeHtml(poster)}" alt="${escapeHtml(movie.title)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}<div class="cloud-poster-fallback" style="display:${poster ? 'none' : 'flex'}">${escapeHtml(movie.title || '暂无海报')}</div>${movie.year ? `<span class="cloud-poster-meta">${escapeHtml(String(movie.year).match(/(?:19|20)\d{2}/)?.[0] || movie.year)}</span>` : ''}${score > 0 ? `<span class="cloud-poster-score">★ ${escapeHtml(movie.score)}</span>` : ''}</div><div class="cloud-poster-title">${escapeHtml(movie.title || '未命名')}</div><div class="cloud-poster-count">磁力 ${movie.magnetCount || (movie.seedUrl ? 1 : 0)} · 网盘 ${movie.cloudCount || 0}</div>${movie.seedUrl ? '<button class="btn cloud-card-offline" style="margin-top:7px;width:100%;padding:7px 8px">添加到115</button>' : ''}</article>`; }).join(''); grid.querySelectorAll('.cloud-poster-card').forEach(card => card.onclick = () => openCloudDetail(card.dataset.cloudId)); loadSitePosters(grid,'butailing'); grid.querySelectorAll('.cloud-card-offline').forEach(button => button.onclick = async event => { event.stopPropagation(); const movie = cloudMovies.find(item => item.id === button.closest('.cloud-poster-card')?.dataset.cloudId); if (!movie?.seedUrl) return; try { const message = await window.cloudsave.submitMagnet(movie.seedUrl, { title: movie.seedRaw?.zname || movie.title || '', movieId: movie.id, mode: cloudMode === 'tv' ? 'tv' : 'movie', size: movie.seedSize || '', seedId:movie.seedId,raw:movie.seedRaw,movieInfo:movie }); status(message || '已提交到当前 115 保存目录'); } catch (error) { status(error.message, true); } }); $('cloudPageLabel').textContent = `${cloudPage} / ${cloudPagesKnown?cloudPages:"…"}`; $('cloudPrev').disabled = cloudPage <= 1; $('cloudNext').disabled = cloudPage >= cloudPages; }
let cloudLibraryRequestId=0;
let cloudPagesKnown=true;
let cloudLibraryLoading=false,cloudRenderedPage=1,cloudRenderedScope='';
$('cloudPageLabel').insertAdjacentHTML('afterend','<span id="cloudPagerStatus" class="sub" role="status" aria-live="polite"></span>');
function cloudPagerBusy(value,message=''){cloudLibraryLoading=value;$('cloudPrev').disabled=value||cloudPage<=1;$('cloudNext').disabled=value||cloudPage>=cloudPages;$('cloudJump').disabled=value;$('cloudNext').textContent=value?'加载中…':'下一页';$('cloudPagerStatus').textContent=message;}
async function loadCloudLibrary(){
 const requestToken=++cloudLibraryRequestId,requestedPage=cloudPage,statusNode=$('cloudLibraryStatus'),filters=['movie','tv'].includes(cloudMode)?{...cloudFilterState}:{},scope=JSON.stringify([cloudMode,cloudSearchQuery,filters]);
 cloudPagerBusy(true,'正在加载第 '+requestedPage+' 页…');statusNode.textContent='正在加载第 '+requestedPage+' 页资源…';$('cloudFilterBtn').disabled=Boolean(cloudSearchQuery)||!['movie','tv'].includes(cloudMode);
 try{const data=await boundedLibraryRequest(cloudSearchQuery?window.cloudsave.cloudSearch(cloudSearchQuery,requestedPage):window.cloudsave.cloudCatalog(cloudMode,requestedPage,filters),'不太灵第'+requestedPage+'页');if(requestToken!==cloudLibraryRequestId)return;
  cloudPagesKnown=data.totalKnown!==false;cloudMovies=data.items||[];cloudPage=Number(data.page)||requestedPage;cloudRenderedPage=cloudPage;cloudRenderedScope=scope;cloudPages=Math.max(1,Math.ceil((Number(data.total)||cloudMovies.length)/(Number(data.limit)||Math.max(1,cloudMovies.length)||20)));if(data.hasNext===true)cloudPages=Math.max(cloudPages,cloudPage+1);
  renderCloudLibrary();cloudPagerBusy(false,'已显示第 '+cloudPage+' 页');$('cloudHomePage').scrollTo({top:0,behavior:'instant'});
  statusNode.textContent=data.filteredPagination?(data.totalKnown?`共 ${data.total} 条符合筛选的资源，按网站全局排序分页`:`已读取 ${data.matchedCached} 条符合筛选的资源，按网站全局排序跨页补齐`):data.nativeFiltered?`官网第 ${cloudPage} 页：原生 ${data.nativeItemCount} 条，当前筛选显示 ${cloudMovies.length} 条（不跨页补齐）`:data.totalKnown===false?`已缓存 ${data.matchedCached} 条符合筛选的资源，后续页面继续读取`:data.fallback?data.fallback:`共 ${data.total||cloudMovies.length} 条资源`;
  window.cloudsave.siteSession().then(value=>{if(requestToken===cloudLibraryRequestId&&!value.loggedIn&&!cloudMovies.some(m=>m.seedUrl))statusNode.textContent+='；未检测到不太灵登录令牌，请先登录网站后刷新';}).catch(()=>{});
 }catch(error){if(requestToken!==cloudLibraryRequestId)return;if(cloudRenderedScope===scope){cloudPage=cloudRenderedPage;renderCloudLibrary();}else{cloudMovies=[];cloudPage=1;cloudPages=1;renderCloudLibrary();}statusNode.textContent=error.message||'资源加载失败';cloudPagerBusy(false,'第 '+requestedPage+' 页加载失败，可再次点击重试');}
 finally{if(requestToken===cloudLibraryRequestId)cloudPagerBusy(false,$('cloudPagerStatus').textContent);}
}

function renderCloudPan() { const tabs = $('cloudPanTabs'); const results = $('cloudPanResults'); if (!tabs || !results) return; const types = [...new Set(cloudPanResults.map(item => item.type))]; const titles = { '115': '115网盘', magnet: '磁力链接', ed2k: '电驴链接', baidu: '百度网盘' }; tabs.innerHTML = types.map(type => `<button class="cloud-pan-tab ${type === cloudPanType ? 'active' : ''}" data-pan-type="${escapeHtml(type)}">${escapeHtml(titles[type] || type)} (${cloudPanResults.filter(item => item.type === type).length})</button>`).join(''); tabs.querySelectorAll('.cloud-pan-tab').forEach(button => button.onclick = () => { cloudPanType = button.dataset.panType; renderCloudPan(); }); const visible = cloudPanResults.filter(item => !cloudPanType || item.type === cloudPanType); results.innerHTML = visible.length ? visible.map((item, index) => `<article class="cloud-pan-result"><h3>${escapeHtml(item.title || item.url)}</h3><div class="cloud-pan-meta">${escapeHtml(item.size || '')}${item.date ? ` · ${escapeHtml(item.date)}` : ''} · ${escapeHtml(item.site || '')}</div><div class="cloud-pan-actions"><button class="btn secondary pan-copy" data-pan-index="${cloudPanResults.indexOf(item)}">复制链接</button>${item.type === 'magnet' || item.type === 'ed2k' ? `<button class="btn pan-offline" data-pan-index="${cloudPanResults.indexOf(item)}">添加到115</button>` : `<button class="btn secondary pan-open" data-pan-index="${cloudPanResults.indexOf(item)}">打开</button>`}</div></article>`).join('') : '<div class="cloud-module-status">暂无匹配资源</div>'; results.querySelectorAll('.pan-copy').forEach(button => button.onclick = async () => { const item = cloudPanResults[Number(button.dataset.panIndex)]; await navigator.clipboard.writeText(item.url + (item.code ? `\n提取码：${item.code}` : '')); status('链接已复制'); }); results.querySelectorAll('.pan-open').forEach(button => button.onclick = () => window.open(cloudPanResults[Number(button.dataset.panIndex)].url)); results.querySelectorAll('.pan-offline').forEach(button => button.onclick = async () => { const item = cloudPanResults[Number(button.dataset.panIndex)]; try { const message = await window.cloudsave.submitMagnet(item.url, { title: item.title || '' }); status(message || '已提交到当前 115 保存目录'); } catch (error) { status(error.message, true); } }); }
async function runCloudPanSearch() { const query = $('cloudPanSearch').value.trim(); if (!query) { $('cloudPanStatus').textContent = '请输入关键词'; return; } $('cloudPanStatus').textContent = '正在搜索…'; try { const result = await window.cloudsave.panSearch(query, 1); cloudPanResults = Array.isArray(result) ? result : result.items || []; cloudPanType = cloudPanResults.some(item => item.type === '115') ? '115' : (cloudPanResults[0]?.type || ''); $('cloudPanStatus').textContent = `找到 ${cloudPanResults.length} 条资源${result.warning ? " · " + result.warning : ""}`; renderCloudPan(); } catch (error) { cloudPanResults = []; renderCloudPan(); $('cloudPanStatus').textContent = error.message || '搜索失败'; } }
async function openCloudDetail(id,fresh=false) {
  cloudTab('cloudDetailPane');
  $('cloudDetailTitle').textContent = '正在加载详情…';
  $('cloudDetailBody').innerHTML = '<div class="cloud-module-status">正在加载影片详情…</div>';
  try {
    const listingMovie = cloudMovies.find(item => item.id === String(id));
    const data = await window.cloudsave.cloudDetail(id,fresh);
    const movie = data.movie || listingMovie || {};
    const poster = posterUrl(movie.poster);
    const seeds = (data.seeds && data.seeds.length) ? data.seeds : (listingMovie?.seedUrl ? [{ title: listingMovie.title || '最新资源', url: listingMovie.seedUrl, size: listingMovie.seedSize || '', quality: '', date: listingMovie.seedDate || '' }] : []);
    const clouds = data.clouds || [];
    $('cloudDetailTitle').textContent = movie.title || '影片详情';
    const infoRows = [
      ['又名', movie.alias], ['导演', movie.director], ['编剧', movie.writer], ['演员', movie.cast],
      ['类型', movie.genre], ['制片国家', movie.country], ['语言', movie.language], ['上映日期', movie.releaseDate]
    ].filter(([, value]) => String(value || '').trim());
    const intro = String(movie.intro || '暂无简介');
    $('cloudDetailBody').innerHTML = `<div class="cloud-detail-summary">${poster ? `<img class="cloud-detail-poster" src="${escapeHtml(poster)}" alt="${escapeHtml(movie.title)}">` : '<div class="cloud-detail-poster cloud-detail-poster-empty">暂无海报</div>'}<div class="cloud-detail-info"><h2>${escapeHtml(movie.title || '未命名')}</h2><div class="cloud-detail-year">${escapeHtml(movie.year ? `（${movie.year}）` : '')}</div><div class="cloud-detail-rating">★ 豆瓣 ${escapeHtml(movie.score || '暂无')}${movie.votes ? ` (${escapeHtml(movie.votes)}人评价)` : ''}</div><div class="cloud-detail-meta">${infoRows.map(([label, value]) => `<p><b>${escapeHtml(label)}：</b>${escapeHtml(value)}</p>`).join('')}</div></div></div><div class="cloud-detail-intro"><h3>剧情简介</h3><p class="cloud-detail-intro-text">${escapeHtml(intro)}</p><button class="cloud-intro-toggle" type="button">${intro.length > 180 ? '展开全部' : ''}</button></div><div class="cloud-detail-primary-tabs"><button class="cloud-detail-primary active" data-primary="magnet">⇩　种子 / 磁力 <em>${seeds.length}</em><b>VIP</b></button><button class="cloud-detail-primary" data-primary="cloud">☁　网盘资源 <em>${clouds.length}</em><b class="free">限免</b></button></div><div id="cloudDetailSubTabs" class="cloud-detail-subtabs"></div><div id="cloudDetailResourceList"></div><div class="cloud-detail-actions"><button id="cloudOpenOriginal" class="btn secondary">打开原网页</button><button id="cloudRefreshResources" class="btn secondary">刷新资源</button></div>`;
    const introText = $('cloudDetailBody').querySelector('.cloud-detail-intro-text');
    const introToggle = $('cloudDetailBody').querySelector('.cloud-intro-toggle');
    if (intro.length > 180) { introText.classList.add('collapsed'); introToggle.onclick = () => { const collapsed = introText.classList.toggle('collapsed'); introToggle.textContent = collapsed ? '展开全部' : '收起'; }; }
    $('cloudOpenOriginal').onclick = () => window.cloudsave.openOriginal(movie.webUrl || (/^\d+$/.test(String(id)) ? `${siteBase}/mv/${id}` : '')).catch(error => status(error.message, true)); $('cloudRefreshResources').onclick = () => openCloudDetail(id,true);
    const categoryLabel = value => ({ baidu: '百度网盘', quark: '夸克网盘', xunlei: '迅雷网盘', '115': '115网盘', aliyun: '阿里网盘', pikpak: 'PikPak', uc: 'UC网盘', '123': '123云盘', tianyi: '天翼云盘', ucdrive: 'UC网盘' }[String(value || '').toLowerCase()] || String(value || '其他'));
    let primary = 'magnet';
    let subFilter = '';
    const detailActions = {
      '.detail-copy': async button => { await navigator.clipboard.writeText(seeds[Number(button.dataset.index)].url); status('链接已复制'); },
      '.detail-guangya': async button => {button.disabled=true;try{const item=seeds[Number(button.dataset.index)];status(await window.cloudsave.guangyaSubmit(item.url,item.title));}catch(e){status(e.message,true);}finally{button.disabled=false;}},
      '.detail-offline': async button => { try { const item = seeds[Number(button.dataset.index)]; const message = await window.cloudsave.submitMagnet(item.url, { title: item.title || '', movieId: id, mode: cloudMode === 'tv' ? 'tv' : 'movie', size: item.size || '',seedId:item.raw?.id,raw:item.raw,movieInfo:movie }); status(message || '已提交到当前 115 保存目录'); } catch (error) { status(error.message, true); } },
      '.detail-seed': button => { const seed = seeds[Number(button.dataset.index)]; const overlay = document.createElement('div'); overlay.className = 'cloud-seed-overlay'; overlay.innerHTML = `<div class="cloud-seed-dialog"><div class="cloud-seed-head"><strong>种子详情</strong><button class="btn secondary seed-close">关闭</button></div><div class="cloud-seed-section"><h3>媒体信息摘要</h3><dl><dt>文件名</dt><dd>${escapeHtml(seed.title || '未命名资源')}</dd><dt>大小</dt><dd>${escapeHtml(seed.size || '未提供')}</dd><dt>画质 / 类型</dt><dd>${escapeHtml(seed.quality || '未提供')}</dd><dt>发布日期</dt><dd>${escapeHtml(seed.date || '未提供')}</dd></dl></div><div class="cloud-seed-section"><h3>种子文件信息</h3><div class="cloud-seed-file">${escapeHtml(seed.title || '未命名种子')}<br><small>${escapeHtml(seed.size || '大小未提供')} · ${escapeHtml(seed.url || '')} · </small></div><p class="cloud-seed-note">当前接口未返回种子内部文件清单，已显示网站返回的资源摘要。</p></div></div>`; document.body.appendChild(overlay); overlay.querySelector('.seed-close').onclick = () => overlay.remove(); overlay.onclick = event => { if (event.target === overlay) overlay.remove(); }; },
      '.detail-cloud-copy': async button => { await navigator.clipboard.writeText(button.dataset.url + (button.dataset.code ? `\n提取码：${button.dataset.code}` : '')); status('网盘链接已复制'); },
      '.detail-cloud-open': button => window.open(button.dataset.url)
    };
    $("cloudDetailResourceList").onclick = async event => {
      const button = event.target.closest("button"); if (!button || !$("cloudDetailResourceList").contains(button)) return;
      for (const [selector, action] of Object.entries(detailActions)) if (button.matches(selector)) { await action(button); break; }
    };
    const renderResources = () => {
      const source = primary === 'magnet' ? seeds : clouds;
      const values = [...new Set(source.map(item => primary === 'magnet' ? (item.quality || '其他') : (item.type || '其他')).filter(Boolean))];
      const sub = $('cloudDetailSubTabs');
      sub.innerHTML = [`<button class="cloud-detail-sub active" data-value="">全部 <em>${source.length}</em></button>`, ...values.map(value => `<button class="cloud-detail-sub" data-value="${escapeHtml(value)}">${escapeHtml(categoryLabel(value))} <em>${source.filter(item => (primary === 'magnet' ? (item.quality || '其他') : (item.type || '其他')) === value).length}</em></button>`)].join('');
      sub.querySelectorAll('.cloud-detail-sub').forEach(button => { button.classList.toggle('active', button.dataset.value === subFilter); button.onclick = () => { subFilter = button.dataset.value; sub.querySelectorAll('.cloud-detail-sub').forEach(item => item.classList.toggle('active', item === button)); renderRows(); }; });
      renderRows();
    };
    const renderRows = () => {
      const source = primary === 'magnet' ? seeds : clouds;
      const visible = source.filter(item => !subFilter || (primary === 'magnet' ? (item.quality || '其他') : (item.type || '其他')) === subFilter);
      const container = $('cloudDetailResourceList');
      const revision = container._renderRevision = (container._renderRevision || 0) + 1;
      container.innerHTML = visible.length ? '<div class="cloud-resource-list"></div>' : '<div class="cloud-module-status">当前分类暂无资源</div>';
      const renderItem = (item, index) => primary === 'magnet' ? `<div class="cloud-resource-item"><span>${escapeHtml(item.title || '磁力资源')}<br><small>${escapeHtml(item.quality || '未标注')} · ${escapeHtml(item.date || '日期未知')}</small></span><small>${escapeHtml(item.size || '大小未知')}</small><button class="btn secondary detail-copy" data-index="${seeds.indexOf(item)}">复制</button><button class="btn detail-offline" data-index="${seeds.indexOf(item)}">添加到115</button><button class="btn secondary detail-guangya" data-index="${seeds.indexOf(item)}">添加到光鸭</button><button class="btn secondary detail-seed" data-index="${seeds.indexOf(item)}">详情</button></div>` : `<div class="cloud-resource-item"><span>${escapeHtml(item.title || item.type || '网盘资源')}<br><small>${escapeHtml([item.quality, item.date].filter(Boolean).join(' · ') || item.url || '未提供')}</small></span><small>${escapeHtml([item.size, item.type].filter(Boolean).join(' · ') || '网盘')}</small><button class="btn secondary detail-cloud-copy" data-url="${escapeHtml(item.url)}" data-code="${escapeHtml(item.code || '')}">复制</button><button class="btn detail-cloud-open" data-url="${escapeHtml(item.url)}">打开</button></div>`;
      const root = container.querySelector('.cloud-resource-list'); let offset = 0;
      const appendBatch = () => {
        if (!root || !container.isConnected || container._renderRevision !== revision) return;
        root.insertAdjacentHTML('beforeend', visible.slice(offset, offset + 100).map(renderItem).join('')); offset += 100;
        if (offset < visible.length) requestAnimationFrame(appendBatch);
      }; appendBatch();
    };
    $('cloudDetailBody').querySelectorAll('.cloud-detail-primary').forEach(button => button.onclick = () => { primary = button.dataset.primary; subFilter = ''; $('cloudDetailBody').querySelectorAll('.cloud-detail-primary').forEach(item => item.classList.toggle('active', item === button)); renderResources(); });
    renderResources();
  } catch (error) { $('cloudDetailTitle').textContent = '详情加载失败'; $('cloudDetailBody').innerHTML = `<div class="cloud-module-status">${escapeHtml(error.message || '请求失败')}</div>`; }
}async function showCloudFilterDialog(){let choices;try{choices=await window.cloudsave.cloudFilters();}catch(error){status(error.message,true);return;}const overlay=document.createElement('div');overlay.className='cloud-filter-overlay native-library-filter';const groups=[['genres','影视类型'],['countries','制片地区'],['years','上映年份'],['qualities','资源画质'],['tags','影视标签']];const sorts=choices.sorts || [{value:'1',label:'更新时间'},{value:'3',label:'添加时间'},{value:'4',label:'上映时间'},{value:'5',label:'评分最高'},{value:'6',label:'评分人数'}];let multi=String(cloudFilterState.genres || '').startsWith('dx,');overlay.innerHTML=`<div class="cloud-filter-dialog"><div class="cloud-filter-head"><strong>不太灵官网筛选</strong><button class="btn secondary cloud-filter-reset">重置</button></div><div class="cloud-filter-scroll">${groups.map(([key,label])=>`<div class="cloud-filter-group"><b>${label}：</b><div><button class="cloud-filter-chip ${!cloudFilterState[key]&&!cloudFilterState[key+'Custom']?'active':''}" data-filter-key="${key}" data-filter-value="">不限</button>${(choices[key] || []).map(value=>`<button class="cloud-filter-chip ${(key==='genres'&&multi?String(cloudFilterState.genres).split(',').includes(value):cloudFilterState[key]===value)?'active':''}" data-filter-key="${key}" data-filter-value="${escapeHtml(value)}">${escapeHtml(value)}</button>`).join('')}${key==='genres'?`<button class="btn secondary native-multi ${multi?'active':''}" type="button">多选</button>`:''}<input class="input native-custom" data-custom="${key}" placeholder="输入${label} →" value="${escapeHtml(cloudFilterState[key+'Custom'] || '')}"></div></div>`).join('')}${cloudMode==='tv'?`<div class="cloud-filter-group"><b>剧集状态：</b><div>${['',...(choices.statuses || ['更新中','已完结'])].map(x=>`<button class="cloud-filter-chip ${String(cloudFilterState.status || '')===x?'active':''}" data-filter-key="status" data-filter-value="${escapeHtml(x)}">${escapeHtml(x || '不限')}</button>`).join('')}</div></div>`:''}<div class="cloud-filter-group"><b>排序方式：</b><div>${sorts.map(x=>`<button class="cloud-filter-chip ${String(cloudFilterState.sort || '1')===x.value?'active':''}" data-filter-key="sort" data-filter-value="${x.value}">${escapeHtml(x.label)}</button>`).join('')}</div></div><div class="native-extra-filters"><label>评分人数至少 <input class="input native-votes" type="number" min="0" step="1" value="${Number(cloudFilterState.minVotes)||0}"></label><label>评分区间 <input class="input native-score-min" type="number" min="0" max="10" step="0.1" value="${String(cloudFilterState.scoreRange || '0x10').split('x')[0]}"> 至 <input class="input native-score-max" type="number" min="0" max="10" step="0.1" value="${String(cloudFilterState.scoreRange || '0x10').split('x')[1] || 10}"></label><label><input class="native-imdb" type="checkbox" ${cloudFilterState.onlyImdb?'checked':''}> 仅看IMDb</label><label><input class="native-cloud" type="checkbox" ${cloudFilterState.onlyCloud?'checked':''}> 仅显示网盘资源</label></div></div><div class="cloud-filter-foot"><button class="btn secondary cloud-filter-cancel">取消</button><button class="btn cloud-filter-apply">应用</button></div></div>`;document.body.append(overlay);
 overlay.querySelector('.native-multi').onclick=event=>{multi=!multi;event.target.classList.toggle('active',multi);if(!multi){const selected=overlay.querySelectorAll('[data-filter-key="genres"].active');selected.forEach((x,i)=>x.classList.toggle('active',i===0));}};
 overlay.querySelectorAll('[data-filter-key]').forEach(button=>button.onclick=()=>{const key=button.dataset.filterKey,value=button.dataset.filterValue,group=Array.from(overlay.querySelectorAll(`[data-filter-key="${key}"]`));if(key==='genres'&&multi&&value){button.classList.toggle('active');group.find(x=>!x.dataset.filterValue).classList.remove('active');}else{group.forEach(x=>x.classList.toggle('active',x===button));}const input=overlay.querySelector(`[data-custom="${key}"]`);if(input)input.value='';});overlay.querySelectorAll('[data-custom]').forEach(input=>input.oninput=()=>{if(input.value.trim())overlay.querySelectorAll(`[data-filter-key="${input.dataset.custom}"]`).forEach(x=>x.classList.remove('active'));});
 overlay.querySelector('.cloud-filter-reset').onclick=()=>{overlay.querySelectorAll('[data-filter-key]').forEach(x=>x.classList.toggle('active',x.dataset.filterKey==='sort'?x.dataset.filterValue==='1':!x.dataset.filterValue));overlay.querySelectorAll('[data-custom]').forEach(x=>x.value='');overlay.querySelector('.native-votes').value=0;overlay.querySelector('.native-score-min').value=0;overlay.querySelector('.native-score-max').value=10;overlay.querySelector('.native-imdb').checked=overlay.querySelector('.native-cloud').checked=false;multi=false;overlay.querySelector('.native-multi').classList.remove('active');};overlay.querySelector('.cloud-filter-cancel').onclick=()=>overlay.remove();overlay.querySelector('.cloud-filter-apply').onclick=()=>{const min=Number(overlay.querySelector('.native-score-min').value),max=Number(overlay.querySelector('.native-score-max').value);if(min<0||max>10||min>max){status('评分范围应为0–10，最低分不能大于最高分',true);return;}const value={sort:'1',minVotes:Math.max(0,Math.round(Number(overlay.querySelector('.native-votes').value)||0)),scoreRange:min+'x'+max,onlyImdb:overlay.querySelector('.native-imdb').checked,onlyCloud:overlay.querySelector('.native-cloud').checked};for(const [key] of [...groups,['status']]){const selected=Array.from(overlay.querySelectorAll(`[data-filter-key="${key}"].active`)).map(x=>x.dataset.filterValue).filter(Boolean);value[key]=key==='genres'&&multi&&selected.length?'dx,'+selected.join(','):selected[0] || '';}value.sort=overlay.querySelector('[data-filter-key="sort"].active')?.dataset.filterValue || '1';overlay.querySelectorAll('[data-custom]').forEach(input=>{if(input.value.trim()){const key=input.dataset.custom,text=input.value.trim();if((choices[key] || []).includes(text)){value[key]=text;}else{value[key]='';value[key+'Custom']=text;}}});cloudFilterState=value;overlay.remove();cloudMovies=[];cloudPage=1;renderCloudLibrary();loadCloudLibrary();};
}
function initCloudModule() { if (cloudModuleReady) return; cloudModuleReady = true; if($('cloudTabLibrary')) $('cloudTabLibrary').onclick = () => { cloudTab('cloudLibraryPane'); loadCloudLibrary(); }; if($('cloudTabPan')) $('cloudTabPan').onclick = () => cloudTab('cloudPanPane'); $('cloudTabSettings').onclick = () => { cloudTab('cloudSettingsPane'); $('cloudFolderSummary').textContent = `当前保存目录：${$('folder').textContent || '根目录'}`; }; $('cloudLibrarySearchBtn').onclick = async () => { cloudSearchQuery = $('cloudLibrarySearch').value.trim(); cloudPage=1; if(cloudSearchQuery) await rememberLibrarySearch(cloudSearchQuery).catch(error=>status(error.message,true)); await loadCloudLibrary(); }; $('cloudLibrarySearch').onkeydown = event => { if (event.key === 'Enter') $('cloudLibrarySearchBtn').click(); }; document.querySelectorAll('.cloud-mode').forEach(button => button.onclick = () => { document.querySelectorAll('.cloud-mode').forEach(item => item.classList.remove('active')); button.classList.add('active'); cloudMode = button.dataset.cloudMode; cloudSearchQuery=''; $('cloudLibrarySearch').value=''; cloudPage = 1; loadCloudLibrary(); }); $('cloudFilterBtn').onclick = showCloudFilterDialog; $('cloudPrev').onclick = () => { if (!cloudLibraryLoading&&cloudPage > 1) { cloudPage--; loadCloudLibrary(); } }; $('cloudNext').onclick = () => { if (!cloudLibraryLoading&&cloudPage < cloudPages) { cloudPage++; loadCloudLibrary(); } }; $('cloudPanSearchBtn').onclick = runCloudPanSearch; $('cloudPanSearch').onkeydown = event => { if (event.key === 'Enter') runCloudPanSearch(); }; $('cloudDetailBack').onclick = () => { cloudTab('cloudLibraryPane'); }; $('cloudOpenSettings').onclick = showSettingsPage; $('cloudOpenMonitor').onclick = showFilterPage; $('cloudOpenLog').onclick = showLogPage;  loadCloudLibrary(); }
function showCloudHome() { hideContentPages(); $('cloudHomePage').style.display = 'block'; setNavActive('showCloudHome'); cloudTab(libraryResumePane); initCloudModule(); }
function showLogPage() { hideContentPages(); $('logPage').style.display = 'flex'; setNavActive('showMonitorLog'); window.cloudsave.monitorState().then(state => renderMonitorLogs(state.logs || [])); }
function showFilterPage() { hideContentPages(); $('filterPage').style.display = 'block'; setNavActive('showMonitorFilter'); window.cloudsave.monitorState().then(showMonitor); }
function showSettingsPage() { hideContentPages(); $('settingsPage').style.display = 'block'; setNavActive('showSettings'); }
async function handleLoginResult(result) { if (result?.error) return status(result.error, true); if (result?.uid) { showAccount(result); status('115 登录成功'); log(`已登录：${result.nickname}`); } }
const submissionSourceLabels = { cloud:'115云下载', auto5:'自动监控七味',auto4:'自动监控聚影',auto3:'自动监控BT影视',auto2:'自动监控观影', auto: '自动监控不太灵磁力链接', manual: '手动提交', batch: '批量离线', legacy: '历史记录' };
const submissionStatusLabels = { success: '已确认保存到目录', pending: '已加入离线任务，等待完成', duplicate: '已提交自动跳过', uncertain: '提交待确认', placement_failed: '保存目录异常', legacy_accepted: '历史已接受', unverified: '下载完成，位置未核实', failed: '失败' };
let submissionRows = [];
let submissionFilteredRows = [];
let submissionRefreshId = 0;
let submissionPage = 1;
let submissionPageSize = (() => { try { const value = Number(localStorage.getItem('offlineHistoryPageSize')); return [25, 50, 100].includes(value) ? value : 50; } catch (_) { return 50; } })();
let submissionFilterSignature = "";
let submissionUpdateTimer = null;
let submissionHistoryDirty = false;
let retryFailedHistoryRunning = false;
function historyHasOpenDetails() { return Boolean($('submitHistoryList').querySelector('details[open]')); }
let batchSubmitting = false;
function submissionSource(item) {if(item.source==='auto'&&(item.website==='qmp4'||String(item.movieId || '').startsWith('qm5:')))return 'auto5';if(item.source==='auto'&&(item.website==='jying'||String(item.movieId || '').startsWith('jy4:')))return 'auto4';if(item.source==='auto'&&(item.website==='btbtla'||String(item.movieId || '').startsWith('bt3:')))return 'auto3'; if(item.source==='auto' && (item.website==='guanying' || String(item.movieId || '').startsWith('gy:')))return 'auto2'; return Object.hasOwn(submissionSourceLabels, item.source) ? item.source : 'legacy'; }
function submissionStatus(item) { return Object.hasOwn(submissionStatusLabels, item.status) ? item.status : 'failed'; }
function submissionMatchesState(item, state) { return state === 'all' || (state === 'submitted' ? ['success', 'pending', 'placement_failed', 'legacy_accepted', 'unverified'].includes(item.status) : state === 'attention' ? ['failed', 'placement_failed', 'uncertain', 'unverified'].includes(submissionStatus(item)) : submissionStatus(item) === state); }
function submissionStatusCounts(rows) {
  const counts={all:rows.length,submitted:0,duplicate:0,attention:0};
  const submitted=new Set(['success','pending','placement_failed','legacy_accepted','unverified']),attention=new Set(['failed','placement_failed','uncertain','unverified']);
  for(const item of rows){const state=submissionStatus(item);if(submitted.has(item.status))counts.submitted++;if(state==='duplicate')counts.duplicate++;if(attention.has(state))counts.attention++;}
  return counts;
}
function showOfflineTaskPane(name) {
  if($('guangyaPane'))$('guangyaPane').hidden=true;if($('guangyaOfflineTab')){$('guangyaOfflineTab').classList.remove('active');$('guangyaOfflineTab').setAttribute('aria-selected','false');}
  const history = name === 'history';
  $('offlineHistoryPane').hidden = !history; $('offlineBatchPane').hidden = history;
  $('offlineHistoryTab').classList.toggle('active', history); $('offlineBatchTab').classList.toggle('active', !history);
  $('offlineHistoryTab').setAttribute('aria-selected', String(history)); $('offlineBatchTab').setAttribute('aria-selected', String(!history));
  if (!history) refreshOfflineBatchFolder();
}
function showOfflineTasksPage() { hideContentPages(); $('offlineTasksPage').style.display = 'block'; setNavActive('showOfflineTasks'); showOfflineTaskPane('history'); renderSubmitHistory(); }
async function refreshOfflineBatchFolder() {
  try { const state = await window.cloudsave.state(); const folder = state.folder || { cid: '0', name: '根目录' }; $('offlineBatchFolder').textContent = `默认目录：${folder.name || '根目录'}${folder.requiresReselect ? ' · 请重新选择保存目录' : ''}`; }
  catch (error) { $('offlineBatchFolder').textContent = `默认目录读取失败：${error.message}`; }
}
let cloudHistoryFilter='all',cloudSyncState={},cloudSyncSettingsLoaded=false;
function renderSubmissionRows() {
  const source = $('submitHistorySource').value; const state = $('submitHistoryStatusFilter').value;
  const query=$('submitHistorySearch').value.trim(),terms=window.cloudsaveHistorySearch.tokens(query);
  const dateFrom=$('submitHistoryDateFrom').value,dateTo=$('submitHistoryDateTo').value,dateRangeValid=window.cloudsaveHistorySearch.validDateRange(dateFrom,dateTo);
  const signature = JSON.stringify([source,state,cloudHistoryFilter,terms,dateFrom,dateTo]);
  if (signature !== submissionFilterSignature) { submissionPage = 1; submissionFilterSignature = signature; }
  const counts=submissionStatusCounts(submissionRows);
  $('submitHistoryCounts').innerHTML = [['all', '总数', counts.all], ['submitted', '已提交/待核对', counts.submitted], ['duplicate', '已提交自动跳过', counts.duplicate], ['attention','需要关注',counts.attention]].map(([key, label, total]) => `<button type="button" class="submission-count-filter${state === key && (key !== 'all' || source === 'all') ? ' active' : ''}" data-history-status="${key}" aria-pressed="${state === key && (key !== 'all' || source === 'all')}"><b>${total}</b>${label}</button>`).join('');
  $('submitHistoryCounts').querySelectorAll('[data-history-status]').forEach(button => button.onclick = () => { cloudHistoryFilter='all';$('submitHistoryStatusFilter').value = button.dataset.historyStatus; if (button.dataset.historyStatus === 'all') {$('submitHistorySource').value = 'all';} renderSubmissionRows(); });
  let visible;
  const cloudTasks=cloudSyncState.tasks || [],cloudCounts=cloudSyncState.counts || {downloading:0,failed:0,completed:0,unknown:0};
  if(cloudHistoryFilter==='all')visible=submissionRows.filter(item=>(source==='all'||submissionSource(item)===source)&&submissionMatchesState(item,state));
  else{
    const local=new Map();for(const row of submissionRows)if(row.uid===cloudSyncState.uid&&!local.has(row.cloudKey || row.url))local.set(row.cloudKey || row.url,row);
    visible=cloudTasks.filter(task=>task.state===cloudHistoryFilter).map(task=>{const row=local.get(task.key);return row?{...row,cloudState:task.state,_cloudStatusRow:true}:{id:'115:'+task.key,uid:cloudSyncState.uid,cloudKey:task.key,url:task.url || (task.key.startsWith('magnet:')?'magnet:?xt=urn:btih:'+task.key.replace(/^magnet:/,''):''),title:task.title || '115云下载任务 '+task.key.replace(/^magnet:/,'').slice(0,12),size:task.size,source:'cloud',status:'remote',cloudState:task.state,time:task.createdAt?new Date(task.createdAt).toISOString():'',folderName:task.folderName,_cloudOnly:true,message:task.state==='unknown'?'115返回了暂不支持的任务状态，无法确认是否已保存；请稍后重新同步或在115核对。':'此任务来自115云下载列表，未写入本地提交历史。'};});
  }
  if(terms.length)visible=visible.filter(item=>window.cloudsaveHistorySearch.matches(item,terms));
  if(dateFrom||dateTo)visible=visible.filter(item=>window.cloudsaveHistorySearch.matchesDateRange(item,dateFrom,dateTo));
  if(!dateRangeValid)visible=[];
  submissionFilteredRows=visible;
  const copyableLinks=window.cloudsaveHistorySearch.uniqueLinks(visible);
  $('copyFilteredHistoryLinks').disabled=!copyableLinks.length;
  $('copyFilteredHistoryLinks').textContent=copyableLinks.length?'复制筛选链接（'+copyableLinks.length+'）':'复制筛选链接';
  $('saveFilteredHistoryLinks').disabled=!copyableLinks.length;
  $('saveFilteredHistoryLinks').textContent=copyableLinks.length?`保存筛选链接TXT（${copyableLinks.length}）`:'保存筛选链接TXT';
  const retryableLinks=[...new Set(visible.filter(item=>item.status==='failed'&&/^(?:magnet:\?|ed2k:\/\/)/i.test(String(item.url||''))).map(item=>item.url.trim()))];
  $('retryFilteredFailedMagnets').disabled=retryFailedHistoryRunning||!retryableLinks.length;
  $('retryFilteredFailedMagnets').textContent=retryableLinks.length?`重试失败磁力（${retryableLinks.length}）`:'重试失败磁力';
  const copyFilteredRowsButton=$('copyFilteredSubmitHistory');
  copyFilteredRowsButton.disabled=!visible.length;
  copyFilteredRowsButton.textContent=visible.length?`复制筛选记录表格（${visible.length}）`:'复制筛选记录表格';
  const exportableRows=visible.filter(item=>!item._cloudOnly&&item.uid&&item.url);
  const exportFilteredButton=$('exportFilteredSubmitHistoryExcel');
  exportFilteredButton.disabled=!exportableRows.length;
  exportFilteredButton.textContent=exportableRows.length?`导出当前筛选为Excel（${exportableRows.length}）`:'导出当前筛选为Excel';
  $('cloudDownloadCounts').innerHTML=[['downloading','正在下载'],['failed','下载失败'],['completed','已完成'],['unknown','状态待确认']].map(([value,label])=>`<button type="button" class="submission-count-filter ${cloudHistoryFilter===value?'active':''}" data-cloud-status="${value}"><b>${cloudCounts[value] || 0}</b>${label}</button>`).join('')+`<span class="sub">当前115账号全部云下载任务 · 上次同步缓存 · “状态待确认”表示接口状态未识别，不代表已保存 · 再次点击取消筛选</span>`;
  $('cloudDownloadCounts').querySelectorAll('[data-cloud-status]').forEach(button=>button.onclick=()=>{cloudHistoryFilter=cloudHistoryFilter===button.dataset.cloudStatus?'all':button.dataset.cloudStatus;$('submitHistorySource').value='all';$('submitHistoryStatusFilter').value='all';renderSubmissionRows();});
  $('submitHistoryStatus').textContent=cloudHistoryFilter==='all'?`显示 ${visible.length} / ${submissionRows.length} 条本地提交记录 · 新记录在上方`:`显示 ${visible.length} 条115云下载任务 · 包括未在本软件提交的任务`;
  if(terms.length)$('submitHistoryStatus').textContent+=' · 已应用本地关键词搜索';
  if(dateFrom||dateTo)$('submitHistoryStatus').textContent+=dateRangeValid?' · 已应用日期范围筛选':' · 开始日期不能晚于结束日期';
  $('clearSubmitHistorySearch').disabled=!query&&!dateFrom&&!dateTo&&source==='all'&&state==='all'&&cloudHistoryFilter==='all';
  const pages = Math.max(1, Math.ceil(visible.length / submissionPageSize));
  submissionPage = Math.min(pages, Math.max(1, submissionPage));
  $('historyPageInfo').textContent = `${submissionPage} / ${pages} 页 · 每页 ${submissionPageSize} 条`;
  $('submissionPageSize').value = String(submissionPageSize);
  $('historyPrevPage').disabled = submissionPage <= 1; $('historyNextPage').disabled = submissionPage >= pages;
  const currentPageRows=visible.slice((submissionPage-1)*submissionPageSize,submissionPage*submissionPageSize);
  const copyCurrentPageButton=$('copyCurrentSubmitHistoryPage');copyCurrentPageButton.disabled=!currentPageRows.length;copyCurrentPageButton.textContent=currentPageRows.length?`复制本页记录（${currentPageRows.length}）`:'复制本页记录';
  const opened = new Set([...$('submitHistoryList').querySelectorAll('details[open]')].map(node => node.closest('[data-submission-id]')?.dataset.submissionId));
  $('submitHistoryList').innerHTML = visible.length ? currentPageRows.map(item => {
    const itemState = submissionStatus(item);const stateLabel=(item._cloudOnly||item._cloudStatusRow)?({completed:'下载成功',failed:'下载失败',downloading:'正在下载',unknown:'状态待确认'}[item.cloudState] || '状态未知'):submissionStatusLabels[itemState]; const itemSource = submissionSource(item);
    const folder = item.folderName || '未记录目录名';
    const record=item.exportRecord || {}, media=record.media || {};
    const metadata=[['文件名',media.filename || item.title],['逐集大小',Object.entries(item.episodeSizes || {}).map(([ep,size])=>ep+' '+Number(size).toFixed(3)+' GB').join('\n')],['时长',media.duration],['分辨率',media.resolution],['帧率',media.frameRate],['视频',media.video],['音频',media.audio],['资源上映日期',record.releaseDate],['类型',record.genre],['制片国家/地区',record.country],['磁力链接发布时间',record.publishDate]];
    const mediaHtml=item._cloudOnly?'':'<details class="submission-media"><summary>资源信息 · '+escapeHtml(item.size || '大小未记录')+'</summary><dl>'+metadata.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escapeHtml(value || '暂未获取')+'</dd></div>').join('')+'</dl></details>';
    return `<article class="offline-history-row" data-submission-id="${escapeHtml(item.id || item.url || item.time)}"><div class="submission-row-head"><span class="submission-source">${submissionSourceLabels[itemSource]}</span><span class="submission-status ${itemState}">${escapeHtml(stateLabel)}</span><time>${escapeHtml(formatLogTimestamp(item.time))}</time></div>${item.title ? `<strong class="submission-title">${escapeHtml(item.title)}</strong>` : ''}<div class="submission-folder">目标目录：${escapeHtml(folder)}</div>${item.cloudState && item.cloudState!=="unknown" ? `<div class="submission-folder">115云下载：${escapeHtml({completed:"下载成功",downloading:"正在下载 · 监控可尝试下一档",failed:"下载失败 · 监控可尝试下一档"}[item.cloudState] || item.cloudState)}（本地同步缓存）</div>` : item.cloudState==="unknown" ? '<div class="submission-folder">115云下载：状态待确认（无法据此判断是否已保存）</div>' : ""}${item.episodeKeys?.length ? `<div class="submission-folder">覆盖集数：${escapeHtml(item.episodeKeys.length > 6 ? item.episodeKeys[0] + " … " + item.episodeKeys.at(-1) + "（共" + item.episodeKeys.length + "集）" : item.episodeKeys.join("、"))}${item.episodeKeys.length > 1 ? " · 大小来源：" + escapeHtml(item.sizeSource || "平均估算") : ""}</div>` : ""}${mediaHtml}<p class="submission-message">${escapeHtml(item.message || '暂无提交反馈')}</p><div class="submission-link-row"><code>${escapeHtml(item.url || '')}</code><button class="btn secondary submission-copy" ${item.url ? '' : 'disabled'} data-submission-url="${escapeHtml(item.url || '')}">${item._cloudOnly?'复制链接':'复制磁力'}</button></div></article>`;
  }).join('') : `<div class="empty">${submissionRows.length ? '没有符合筛选的提交记录' : '暂无提交记录'}</div>`;
  $('submitHistoryList').querySelectorAll('[data-submission-id]').forEach(node => { if (opened.has(node.dataset.submissionId)) node.querySelector('details').open = true; });
  $('submitHistoryList').onclick = async event => {
    const button = event.target.closest('.submission-copy'); if (!button || !$('submitHistoryList').contains(button)) return;
    try { await navigator.clipboard.writeText(button.dataset.submissionUrl); const label = button.textContent; button.textContent = '已复制'; setTimeout(() => { button.textContent = label; }, 1600); }
    catch (error) { $('submitHistoryStatus').textContent = `复制失败：${error.message}`; }
  };


}
async function renderSubmitHistory() {
  const requestId = ++submissionRefreshId; const button = $('refreshSubmitHistory'); button.disabled = true;
  try { const rows = await window.cloudsave.submitHistory(); if (requestId !== submissionRefreshId) return; submissionHistoryDirty = false; submissionRows = Array.isArray(rows) ? rows : []; if(window.cloudsave.cloudDownloadState){const sync=await window.cloudsave.cloudDownloadState();if(requestId===submissionRefreshId){cloudSyncState=sync;renderSubmissionRows();renderCloudSyncStatus(sync);if(!cloudSyncSettingsLoaded){$('cloudSyncEnabled').checked=sync.enabled!==false;$('cloudSyncInterval').value=sync.intervalMinutes || 60;$('cloudSyncLookback').value=sync.lookbackHours || 24;cloudSyncSettingsLoaded=true;}}}else renderSubmissionRows(); }
  catch (error) { if (requestId === submissionRefreshId) $('submitHistoryStatus').textContent = `记录读取失败：${error.message}`; }
  finally { if (requestId === submissionRefreshId) button.disabled = false; }
}
$('submitHistoryList').addEventListener('toggle', () => {
  if (submissionHistoryDirty && !historyHasOpenDetails() && $('offlineTasksPage').style.display === 'block' && !$('offlineHistoryPane').hidden) renderSubmitHistory();
}, true);
$('showOfflineTasks').onclick = showOfflineTasksPage;
$('offlineHistoryTab').onclick = () => { showOfflineTaskPane('history'); renderSubmitHistory(); };
$('offlineBatchTab').onclick = () => showOfflineTaskPane('batch');
$('refreshSubmitHistory').onclick = renderSubmitHistory;
$('historyPrevPage').onclick = () => { submissionPage--; renderSubmissionRows(); };
$('historyNextPage').onclick = () => { submissionPage++; renderSubmissionRows(); };
$('copyCurrentSubmitHistoryPage').onclick=async()=>{renderSubmissionRows();const rows=submissionFilteredRows.slice((submissionPage-1)*submissionPageSize,submissionPage*submissionPageSize);if(!rows.length)return;try{await navigator.clipboard.writeText(window.cloudsaveHistoryCopy.rowsToTsv(rows));$('submitHistoryStatus').textContent=`已复制当前第 ${submissionPage} 页的 ${rows.length} 条记录表格`;status(`已复制本页 ${rows.length} 条记录`);}catch(error){$('submitHistoryStatus').textContent='本页记录复制失败：'+error.message;status(error.message,true);}};
$('submissionPageSize').onchange = () => { const value = Number($('submissionPageSize').value); submissionPageSize = [25, 50, 100].includes(value) ? value : 50; try { localStorage.setItem('offlineHistoryPageSize', String(submissionPageSize)); } catch (_) {} submissionPage = 1; renderSubmissionRows(); };
$('submitHistorySource').onchange = ()=>{cloudHistoryFilter='all';renderSubmissionRows();};
$('submitHistoryStatusFilter').onchange = ()=>{cloudHistoryFilter='all';renderSubmissionRows();};
let submissionSearchTimer;
$('submitHistorySearch').oninput=()=>{clearTimeout(submissionSearchTimer);submissionSearchTimer=setTimeout(renderSubmissionRows,180);};
$('submitHistoryDateFrom').onchange=renderSubmissionRows;$('submitHistoryDateTo').onchange=renderSubmissionRows;
$('clearSubmitHistorySearch').onclick=()=>{clearTimeout(submissionSearchTimer);$('submitHistorySearch').value='';$('submitHistoryDateFrom').value='';$('submitHistoryDateTo').value='';$('submitHistorySource').value='all';$('submitHistoryStatusFilter').value='all';cloudHistoryFilter='all';renderSubmissionRows();$('submitHistorySearch').focus();};
$('submitHistorySearch').onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();clearTimeout(submissionSearchTimer);$('submitHistorySearch').value='';renderSubmissionRows();}};
$('copyFilteredHistoryLinks').onclick=async()=>{renderSubmissionRows();const links=window.cloudsaveHistorySearch.uniqueLinks(submissionFilteredRows);if(!links.length)return;try{await navigator.clipboard.writeText(links.join('\n'));$('submitHistoryStatus').textContent='已复制 '+links.length+' 条去重链接（全部匹配页面） · '+$('submitHistoryStatus').textContent;status('已复制 '+links.length+' 条筛选链接');}catch(error){$('submitHistoryStatus').textContent='筛选链接复制失败：'+error.message;status(error.message,true);}};
$('saveFilteredHistoryLinks').onclick=async()=>{renderSubmissionRows();const links=window.cloudsaveHistorySearch.uniqueLinks(submissionFilteredRows);if(!links.length)return;const button=$('saveFilteredHistoryLinks');button.disabled=true;let feedback;try{const result=await window.cloudsave.saveFilteredHistoryLinks(links);feedback=result.cancelled?'已取消保存筛选链接':`已保存 ${result.count} 条去重筛选链接：${result.path}`;}catch(error){feedback=`筛选链接保存失败：${error.message}`;}finally{button.disabled=false;renderSubmissionRows();$('submitHistoryStatus').textContent=feedback;}};
$('retryFilteredFailedMagnets').onclick=async()=>{renderSubmissionRows();const links=[...new Set(submissionFilteredRows.filter(item=>item.status==='failed'&&/^(?:magnet:\?|ed2k:\/\/)/i.test(String(item.url||''))).map(item=>item.url.trim()))];if(!links.length||retryFailedHistoryRunning)return;retryFailedHistoryRunning=true;renderSubmissionRows();let folder='当前默认目录';try{const state=await window.cloudsave.state();if(state.folder?.requiresReselect){retryFailedHistoryRunning=false;renderSubmissionRows();$('submitHistoryStatus').textContent='默认保存目录需要重新选择，请先到“账号与设置”读取并选择有效目录；本次未重试。';return;}folder=state.folder?.name||'根目录';}catch(error){retryFailedHistoryRunning=false;renderSubmissionRows();$('submitHistoryStatus').textContent=`读取默认目录失败，未重试：${error.message}`;return;}if(!window.confirm(`将筛选结果中明确失败的 ${links.length} 条磁力/电驴链接重新提交到“${folder}”。提交待确认、保存目录异常和分享链接不会重试。继续吗？`)){retryFailedHistoryRunning=false;renderSubmissionRows();return;}$('submitHistoryStatus').textContent=`正在向“${folder}”重新提交 ${links.length} 条明确失败的链接…`;let feedback;try{const results=await window.cloudsave.batchSubmitMagnets(links.join('\n'));const count=state=>results.filter(item=>submissionMatchesState(item,state)).length;feedback=`重试完成：成功提交 ${count('submitted')}，自动跳过 ${count('duplicate')}，待确认 ${count('uncertain')}，失败或需关注 ${count('attention')}`;await renderSubmitHistory();}catch(error){feedback=`重试失败记录时发生错误：${error.message}`;}finally{retryFailedHistoryRunning=false;renderSubmissionRows();$('submitHistoryStatus').textContent=feedback;}};
$('copyFilteredSubmitHistory').onclick=async()=>{renderSubmissionRows();if(!submissionFilteredRows.length)return;try{await navigator.clipboard.writeText(window.cloudsaveHistoryCopy.rowsToTsv(submissionFilteredRows));$('submitHistoryStatus').textContent=`已复制当前筛选的 ${submissionFilteredRows.length} 条记录表格（全部匹配页面）`;status(`已复制 ${submissionFilteredRows.length} 条筛选记录`);}catch(error){$('submitHistoryStatus').textContent='筛选记录复制失败：'+error.message;status(error.message,true);}};
$('copySubmitHistory').onclick = async () => { try { const count = await window.cloudsave.copySubmitHistory(); renderSubmissionRows();$('submitHistoryStatus').textContent = `已提取全部 ${count} 条历史记录到剪贴板 · `+$('submitHistoryStatus').textContent.replace(/^显示 /,'当前筛选显示 '); status(`已提取 ${count} 条历史提交记录`); } catch (error) { $('submitHistoryStatus').textContent = error.message; } };
$('exportFilteredSubmitHistoryExcel').onclick = async () => {
  renderSubmissionRows();
  const keys=[...new Set(submissionFilteredRows.filter(item=>!item._cloudOnly&&item.uid&&item.url).map(item=>`${item.uid}|${item.cloudKey||item.url}`))];
  if(!keys.length)return;
  const button=$('exportFilteredSubmitHistoryExcel');button.disabled=true;
  try { const result=await window.cloudsave.exportSubmitHistoryExcel(keys);$('submitHistoryStatus').textContent=result.cancelled?'已取消筛选导出':`已导出当前筛选的 ${result.count} 条记录；${result.missing||0} 条媒体信息不完整。${result.reasons?.length?result.reasons.join('；')+'。':''}文件：${result.path}`; }
  catch(error){$('submitHistoryStatus').textContent=`筛选导出失败：${error.message}`;}
  finally{button.disabled=false;}
};
 $('exportSubmitHistoryExcel').onclick = async () => {
  const button = $('exportSubmitHistoryExcel'); button.disabled = true;
  try { const result = await window.cloudsave.exportSubmitHistoryExcel(); $('submitHistoryStatus').textContent = result.cancelled ? '已取消导出' : `已导出全部 ${result.count} 条历史记录；${result.missing || 0} 条媒体信息不完整。${result.reasons?.length ? result.reasons.join("；") + "。" : ""}文件：${result.path}`; }
  catch (error) { $('submitHistoryStatus').textContent = `导出失败：${error.message}`; }
  finally { button.disabled = false; }
};
function updateBatchSubmitButton() { $('batchSubmit').disabled = batchSubmitting || !$('batchMagnets').value.trim(); }
$('batchMagnets').addEventListener('input', updateBatchSubmitButton);
$('batchSubmit').onclick = async () => {
  if (batchSubmitting) return;
  const raw = $('batchMagnets').value.trim();
  if (!raw || !/(?:^|\s)(?:magnet:\?|ed2k:\/\/)/i.test(raw)) { $('batchStatus').textContent = '请先粘贴有效的 magnet 或 ed2k 链接，每行一条'; return; }
  batchSubmitting = true; updateBatchSubmitButton(); $('batchMagnets').disabled = true; $('batchSubmit').textContent = '正在提交…'; $('batchStatus').textContent = '正在逐条提交，请等待处理结果…'; $('batchResultList').innerHTML = '';
  try {
    const results = await window.cloudsave.batchSubmitMagnets($('batchResourceMode')?{raw,mode:$('batchResourceMode').value}:raw); const count = state => results.filter(item => submissionMatchesState(item, state)).length;
    $('batchStatus').textContent = `处理 ${results.length} 条：已提交/待核对 ${count('submitted')}，已提交自动跳过 ${count('duplicate')}，提交待确认 ${count('uncertain')}，失败或需检查 ${count('failed') + count('placement_failed')}`;
    $('batchResultList').innerHTML = results.map(item => `<div class="offline-batch-result"><span class="submission-status ${submissionStatus(item)}">${submissionStatusLabels[submissionStatus(item)]}</span><p>${escapeHtml(item.message || '')}</p><code>${escapeHtml(item.url || '')}</code></div>`).join('');
    await renderSubmitHistory();
  } catch (error) { $('batchStatus').textContent = `批量提交未完成：${error.message}。已处理条目可在提交记录查看。`; await renderSubmitHistory(); }
  finally { batchSubmitting = false; $('batchMagnets').disabled = false; $('batchSubmit').textContent = '批量添加到115'; updateBatchSubmitButton(); }
};
if (typeof window.cloudsave.onSubmitHistoryUpdated === 'function') window.cloudsave.onSubmitHistoryUpdated(() => {
  submissionHistoryDirty = true;
  if (historyHasOpenDetails() || submissionUpdateTimer || $('offlineTasksPage').style.display !== 'block' || $('offlineHistoryPane').hidden) return;
  submissionUpdateTimer = setTimeout(() => {
    submissionUpdateTimer = null;
    if ($('offlineTasksPage').style.display === 'block' && !$('offlineHistoryPane').hidden && !historyHasOpenDetails()) renderSubmitHistory();
  }, 1000);
});
$('login').onclick = async () => { status('请在新窗口完成 115 登录…'); await handleLoginResult(await window.cloudsave.loginWindow()); await refreshState(); };
$('logout').onclick = async () => { await window.cloudsave.logout(); showAccount({}); status('已退出 115'); };
$('saveCookie').onclick = async () => { try { const result = await window.cloudsave.validateCookie($('cookie').value); await handleLoginResult(result); } catch (e) { status(e.message, true); } };
$('siteLogin').onclick = async () => { const button = $('siteLogin'); button.disabled = true; $('siteLoginHint').textContent = '请在独立窗口完成登录，然后关闭窗口'; try { const result = await window.cloudsave.siteLoginWindow(); $('siteLoginHint').textContent = result.loggedIn ? '网站登录会话已保存，资源库自动使用该账号' : '未检测到登录令牌，请重新登录'; } catch(error) { $('siteLoginHint').textContent = error.message; } finally { button.disabled = false; } };
$('copyCookie').onclick = async () => { try { await window.cloudsave.copyCookie(); status('已复制 Cookie，可用于恢复 115 会话'); } catch (e) { status(e.message, true); } };
$('loadFolders').onclick = async () => { try {
  const state = await window.cloudsave.state(); const folders = await window.cloudsave.folders('0');
  $('folders').innerHTML = '<option value="">请选择保存目录</option><option value="0">根目录</option>' + folders.map(f => `<option value="${escapeHtml(f.cid)}">${escapeHtml(f.name)}</option>`).join('');
  const savedCid = String(state.folder?.cid ?? '0');
  $('folders').value = [...$('folders').options].some(option => option.value === savedCid) ? savedCid : '';
  status(`已读取 ${folders.length} 个文件夹，请选择后设为默认目录`);
} catch (e) { status(e.message, true); } };
$('setFolder').onclick = async () => { try {
  const select = $('folders'); if (!select.value) throw new Error('请先选择保存目录');
  const folder = await window.cloudsave.setFolder({ cid: select.value, name: select.options[select.selectedIndex].textContent });
  $('folder').textContent = folder.name;
  status(`默认保存目录：${folder.name}`);
} catch(error) { status(error.message, true); } };
$('monitorDateMode').onchange = updateMonitorDateInputs;
$('monitorCompareSize').onchange = async () => { const input = $('monitorCompareSize'); const checked = input.checked; input.disabled = true; try { const current = await window.cloudsave.monitorState(); const saved = await window.cloudsave.setMonitor({ enabled: current.enabled, intervalMinutes: current.intervalMinutes, filters: { ...current.filters, compareSize: checked }, deferRun: true }); showMonitor(saved); status(checked ? '已开启最大版本比较，下一轮按本地记录只提交更大版本' : '已关闭大小比较；已处理磁力仍会跳过'); } catch(error) { input.checked = !checked; status(error.message, true); } finally { input.disabled = false; } };

$('monitorEnabled').onchange = async () => { try { showMonitor(await window.cloudsave.setMonitor({ enabled: $('monitorEnabled').checked, intervalMinutes: $('monitorInterval').value })); } catch (e) { status(e.message, true); } };
$('monitorInterval').onchange = async () => { if ($('monitorEnabled').checked) showMonitor(await window.cloudsave.setMonitor({ enabled: true, intervalMinutes: $('monitorInterval').value })); };
document.querySelectorAll('.filter-chip').forEach(button => button.onclick = () => {
  const group = button.dataset.filterGroup;
  const value = button.dataset.filterValue;
  const buttons = [...document.querySelectorAll(`[data-filter-group="${group}"]`)];
  if (group === 'sort' || group === 'scoreRange' || !value) {
    buttons.forEach(item => item.classList.toggle('active', item === button));
  } else {
    button.classList.toggle('active');
    const anySelected = buttons.some(item => item.dataset.filterValue && item.classList.contains('active'));
    buttons.find(item => item.dataset.filterValue === '')?.classList.toggle('active', !anySelected);
  }
});
$('showMonitorFilter').onclick = showFilterPage;
$('showCloudHome').onclick = showCloudHome;

$('showSettings').onclick = showSettingsPage;
 $('closeSettings').onclick = () => { showCloudHome(); cloudTab('cloudSettingsPane'); };
 $('closeMonitorFilter').onclick = () => { showCloudHome(); cloudTab('cloudSettingsPane'); };
document.querySelectorAll('[data-save-modes]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-save-modes]').forEach(b=>b.classList.toggle('active',b===button));monitorFiltersDirty=true;status('保存类型已选择，请点击保存筛选生效');});
$('saveMonitorFilters').onclick = async () => { try { const filters = readMonitorFilters(); const state = await window.cloudsave.setMonitor({ enabled: $('monitorEnabled').checked, intervalMinutes: $('monitorInterval').value,scanOnly:Boolean($('btlScanOnly')?.checked), filters }); monitorFiltersDirty = false; appliedMonitorFiltersSignature = ''; showMonitor(state); status('监控筛选条件已保存'); log(`监控筛选已更新：${filters.genres.length + filters.countries.length + filters.years.length + filters.qualities.length + filters.tags.length} 个条件`); } catch (e) { status(e.message, true); } };
$('runMonitor').onclick = async () => {
  const button = $('runMonitor'); button.disabled = true;
  try {
    const savedState = await window.cloudsave.setMonitor({ enabled: $('monitorEnabled').checked, intervalMinutes: $('monitorInterval').value, scanOnly:Boolean($('btlScanOnly')?.checked),filters: readMonitorFilters(), deferRun: true });
    monitorFiltersDirty = false; appliedMonitorFiltersSignature = ''; showMonitor(savedState);
    status('正在扫描符合筛选的资源；中断后可继续扫描…');
    const result = await window.cloudsave.runMonitor();
    showMonitor(result); status(result.lastMessage || result.message || '检查完成', Boolean(result.error));
  } catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
};
$('stopMonitor').onclick=()=>window.cloudsave.stopMonitor().then(state=>{showMonitor(state);status('已请求停止本次筛选，等待当前请求结束；进度将保留');}).catch(error=>status(error.message,true));
$('showMonitorLog').onclick = showLogPage;
if ($('clearMonitorLog')) $('clearMonitorLog').onclick = async () => { await window.cloudsave.clearMonitorLogs(); renderMonitorLogs([]); };
$('pauseLog').onclick = () => { logAutoRefresh = !logAutoRefresh; $('pauseLog').textContent = logAutoRefresh ? '暂停自动刷新' : '继续自动刷新'; };
$('downloadLog').onclick = async () => { const state = await window.cloudsave.monitorState(); const text = typeof window.cloudsave.monitorLogText==='function' ? await window.cloudsave.monitorLogText() : (state.logs || []).map(item => `${formatLogTimestamp(item.time)} - ${item.source || 'cloudsave_monitor'} - ${String(item.level || 'info').toUpperCase()} - ${item.message || ''}${item.details ? `\n${item.details}` : ''}`).join('\n'); const blob = new Blob([text], { type: 'text/plain;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `cloudsave-monitor-${new Date().toISOString().slice(0,10)}.log`; link.click(); URL.revokeObjectURL(link.href); };
$('newLog').onclick = () => { const list = $('monitorLogList'); list.scrollTop = 0; logAtBottom = true; $('newLog').style.display = 'none'; };
$('monitorLogList').addEventListener('scroll', event => { logAtBottom = event.target.scrollTop < 20; if (logAtBottom) $('newLog').style.display = 'none'; });
window.cloudsave.onMonitorStatus(showMonitor);
Promise.all([refreshState(), window.cloudsave.monitorState().then(showMonitor)]).catch(e => status(e.message, true));



















$('exportScanExcel').onclick = async () => {
  const button = $('exportScanExcel'); button.disabled = true; $('cancelScanExport').hidden = false; $('scanExportStatus').textContent = '请选择Excel保存位置…';
  try { const result = await window.cloudsave.exportScanExcel(true); $('scanExportStatus').textContent = result.cancelled ? '已取消导出' : `已导出 ${result.count} 条${result.partialScan ? '（当前已扫描部分）' : ''}；${result.missing} 条媒体信息不完整，缺失字段留空。${result.reasons?.length ? "原因：" + result.reasons.join("；") + "。" : ""}文件：${result.path}`; }
  catch(error) { $('scanExportStatus').textContent = error.message; }
  finally { button.disabled = false; $('cancelScanExport').hidden = true; }
};
$('cancelScanExport').onclick = async () => { await window.cloudsave.cancelScanExport(); $('scanExportStatus').textContent = '停止继续读取网站摘要，正在导出已获取的信息…'; };
window.cloudsave.onScanExportProgress(message => { $('scanExportStatus').textContent = message; });

showCloudHome();

if ($('guanyingLogin')) $('guanyingLogin').onclick = async () => { const button=$('guanyingLogin'); button.disabled=true; $('guanyingLoginHint').textContent='请在独立窗口登录观影，完成后关闭窗口'; try { const result=await window.cloudsave.guanyingLoginWindow(); $('guanyingLoginHint').textContent=result.accessReady?'观影验证已完成，会话已保存；返回资源库观影重新加载即可':result.sessionSaved?'会话已保存，但验证或登录尚未完成，请重新打开观影窗口':'未保存网站会话，请重新打开登录页'; } catch(error) { $('guanyingLoginHint').textContent=error.message; } finally { button.disabled=false; } };

// Both views share each site's persisted request interval; this controls website calls, not115 submissions.
function rateMarkup(id){return `<label style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">请求间隔 <input id="${id}" class="input" type="number" min="1" max="60" value="3" style="width:75px"> 秒 <span class="sub">建议3–8秒；限流时10–30秒，缓存读取不等待。</span></label>`;}
$('posterSize').parentElement.insertAdjacentHTML('afterend',rateMarkup('btLibraryRate'));
$('monitorMaxItems').closest('.monitor-limits').insertAdjacentHTML('beforeend',rateMarkup('btMonitorRate'));
for(const id of ['btLibraryRate','btMonitorRate'])$(id).onchange=()=>window.cloudsave.resourceRates({butailing:Number($(id).value)*1000}).then(value=>{for(const target of ['btLibraryRate','btMonitorRate'])$(target).value=value.butailing/1000;}).catch(error=>status(error.message,true));
window.cloudsave.resourceRates?.().then(value=>{for(const id of ['btLibraryRate','btMonitorRate'])$(id).value=value.butailing/1000;}).catch(()=>{});

// Compact category toolbar and a separate sidebar entry for search.
const btCategoryRow=document.querySelector('#cloudLibraryPane .cloud-library-modes');
const btSettings=$('cloudTabSettings');btCategoryRow.appendChild(btSettings);
const btDisplay=document.querySelector('#cloudLibraryPane .library-display-controls');
btCategoryRow.append(...btDisplay.children);btDisplay.remove();
const btRate=$('btLibraryRate').closest('label');btRate.title='建议3–8秒；限流时10–30秒，缓存读取不等待。';btRate.querySelector('.sub')?.remove();
document.querySelector('.cloud-module-tabs')?.remove();
$('showCloudHome').insertAdjacentHTML('afterend','<button id="showCloudPan" class="nav-btn" title="盘搜"><span class="nav-icon" aria-hidden="true">⌕</span><span class="nav-label">盘搜</span></button>');
$('showCloudPan').onclick=()=>{hideContentPages();$('cloudHomePage').style.display='block';initCloudModule();cloudTab('cloudPanPane');setNavActive('showCloudPan');};

$('cloudSettingsPane').insertAdjacentHTML('afterbegin','<button id="cloudSettingsBack" class="btn secondary">返回资源库</button>');
$('cloudSettingsBack').onclick=()=>cloudTab('cloudLibraryPane');

$('cloudSyncSave').onclick=async()=>{try{const input=$('cloudSyncInterval');if(!input.reportValidity())return;cloudSyncState=await window.cloudsave.cloudDownloadSettings({enabled:$('cloudSyncEnabled').checked,intervalMinutes:Number($('cloudSyncInterval').value),lookbackHours:Number($('cloudSyncLookback').value)});cloudSyncSettingsLoaded=true;$('cloudSyncInterval').value=cloudSyncState.intervalMinutes;$('cloudSyncEnabled').checked=cloudSyncState.enabled;await renderSubmitHistory();status(cloudSyncState.enabled?`已保存：每 ${cloudSyncState.intervalMinutes} 分钟同步115云下载`:'已关闭115定时同步；提交成功后仍自动增量更新');}catch(error){status(error.message,true);}};
let manualCloudSyncBusy=false;
async function runCloudDownloadSync(mode){
  if(manualCloudSyncBusy)return;manualCloudSyncBusy=true;
  cloudSyncState={...cloudSyncState,running:true,progress:{phase:'reading',mode,page:0,pages:0,pageReads:0,fetchedCount:0,error:''}};
  $('cloudSyncNow').disabled=true;$('cloudSyncFull').disabled=true;
  $('cloudDownloadSyncStatus').textContent=mode==='full'?'正在全部同步115云下载；完整读取成功后建立本地缓存…':'正在从上次同步位置增量读取115云下载，保留历史缓存…';
  try{cloudSyncState=await window.cloudsave.syncCloudDownloads({mode});await renderSubmitHistory();status(mode==='full'?'115云下载全部同步完成；后续自动增量更新':'115云下载增量结果已保存至本地');}
  catch(error){cloudSyncState={...cloudSyncState,running:false,progress:{...cloudSyncState.progress,phase:'failed',error:error.message}};renderCloudSyncStatus();status(error.message,true);}
  finally{manualCloudSyncBusy=false;$('cloudSyncNow').disabled=Boolean(cloudSyncState.running);$('cloudSyncFull').disabled=Boolean(cloudSyncState.running);}
}
$('cloudSyncNow').onclick=()=>runCloudDownloadSync('incremental');
$('cloudSyncFull').onclick=()=>runCloudDownloadSync('full');

function renderCloudSyncStatus(sync=cloudSyncState){
  const node=$('cloudDownloadSyncStatus');if(!node)return;
  const progress=sync.progress || {},last=sync.syncedAt?'上次同步：'+new Date(sync.syncedAt).toLocaleString()+` · 累计缓存${sync.cachedCount ?? sync.count ?? 0}条 · 本次列表读取${sync.pageReads || 0}页/${sync.fetchedCount ?? sync.readCount ?? 0}条，旧任务核对${sync.statusChecked || 0}条${sync.statusErrors?'（未确认'+sync.statusErrors+'条）':''} · 新增${sync.added || 0}条，变化${sync.changed || 0}条`:'尚未同步，首次仅读取所选时间范围';
  let live=sync.running?(progress.mode==='full'?`正在全部同步：第${progress.page || 0}/${progress.pages || '?'}页，已读${progress.fetchedCount || 0}条`:progress.phase==='checking'?`正在核对旧任务：${progress.statusChecked || 0}/${progress.statusTotal || 0}条`:`正在增量读取：已读${progress.pageReads || progress.page || 0}页/${progress.fetchedCount || 0}条`):progress.phase==='failed'?`同步失败：${progress.error || '网络异常'}；保留上次缓存`:'';
  const next=sync.nextSyncAt || (sync.syncedAt?Number(sync.syncedAt)+(sync.intervalMinutes || 60)*60000:0),seconds=Math.max(0,Math.ceil((next-Date.now())/1000));
  node.textContent=`115云下载 · 提交即增量更新版20261009 · ${sync.fullSyncedAt?'全量缓存已建立（'+new Date(sync.fullSyncedAt).toLocaleString()+'） · ':''}${sync.checkpoint||sync.fullSyncedAt?'从上次成功同步继续':'首次/范围变更：最近'+(sync.lookbackHours || 24)+'小时'}（增量保留5分钟重叠；统计为累计缓存） · ${live?live+' · ':''}${last} · ${sync.enabled===false?'定时同步已关闭（提交后仍自动更新）':`自动间隔${sync.intervalMinutes || 60}分钟${next&&!sync.running?' · 下次同步：'+new Date(next).toLocaleString()+`（约${Math.floor(seconds/60)}分${seconds%60}秒后）`:''}`}`;
  $('cloudSyncNow').disabled=Boolean(sync.running||manualCloudSyncBusy);
  $('cloudSyncFull').disabled=Boolean(sync.running||manualCloudSyncBusy);
}
window.cloudsave.onCloudDownloadProgress?.(state=>{cloudSyncState={...cloudSyncState,...state};renderCloudSyncStatus();});
setInterval(()=>{if($('offlineTasksPage').style.display==='block')renderCloudSyncStatus();},1000);
function unifyMonitorHeader(card,title,enabledId,intervalId,rateId,autoId){
  const header=document.createElement('div');header.className='monitor-top-header';
  const heading=card.querySelector(':scope > .label') || document.createElement('div');heading.className='monitor-top-title';heading.textContent=title;
  const actions=document.createElement('div');actions.className='monitor-top-actions';
  const enabled=$(enabledId),enabledLabel=enabled.closest('label');for(const text of [...enabledLabel.childNodes])if(text.nodeType===3)text.remove();enabledLabel.append(' 自动监控');
  const auto=document.createElement('label');auto.innerHTML=`<input id="${autoId}" type="checkbox" checked> 自动提交到默认目录`;
  actions.append(enabledLabel,auto);
  const rate=$(rateId).closest('label'),rateRow=document.createElement('div');rateRow.className='monitor-rate-row';rateRow.append(rate);
  const toolbar=$(intervalId).closest('.row');for(const button of toolbar.querySelectorAll('button'))button.classList.add('secondary');actions.append(...toolbar.childNodes);toolbar.remove();header.append(heading,actions);card.prepend(header);
  const state=card.querySelector(':scope > .status');card.insertBefore(rateRow,state);
  card.classList.add('monitor-unified');return $(autoId);
}
unifyMonitorHeader($('monitorEnabled').closest('.card'),'自动监控不太灵磁力链接','monitorEnabled','monitorInterval','btMonitorRate','monitorAutoSubmit');
$('monitorAutoSubmit').onchange=async()=>{try{const current=await window.cloudsave.monitorState();showMonitor(await window.cloudsave.setMonitor({enabled:$('monitorEnabled').checked,autoSubmit:$('monitorAutoSubmit').checked,intervalMinutes:current.intervalMinutes,deferRun:true}));}catch(error){status(error.message,true);}};

function loadSitePosters(root,site){window.cloudsaveUI.posters(root,site);}

function boundedLibraryRequest(promise,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+'读取超时；请重新加载，已有本地缓存会保留')),90000);})]).finally(()=>clearTimeout(timer));}
