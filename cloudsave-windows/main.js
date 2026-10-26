const { app, BrowserWindow, ipcMain, safeStorage, session, clipboard, shell, dialog, Menu, WebContentsView, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const persistentRuntime = app.isPackaged || Boolean(process.env?.CLOUDSAVE_STORAGE_ROOT);
const portableStorage = persistentRuntime
  ? require('./portable-storage').createPortableStorage(app, safeStorage, process.env.CLOUDSAVE_STORAGE_ROOT || process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath)) : null;

const applicationVersion = require('./package.json').version;
const ownsApplicationLock = require('./startup-instance').acquireInstance(app, dialog, applicationVersion);
if (!ownsApplicationLock) app.exit(0);
const { filterRows: filterHistoryExportRows } = require('./history-export');
const share115Api = require('./share115-api.js');
const jsonStore = persistentRuntime ? new (require('./buffered-json').BufferedJson)(1200) : null;
let configCache;
let configCheckedAt = 0;
let configDiskMtime = 0;
let shuttingDown = false;
let guangyaModule=null,multiCloudModule=null;
let pan123Monitor=null,share115Monitor=null,share115SetupError='';
const lifecycleTimers = [];
const SITE = 'https://www.0bt0.com';
const SITE_PARAMS = { app_id: '83768d9ad4', identity: '23734adac0301bccdcb107c4aa21f96c' };
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');
const RESOURCE_DATABASE_FILE = () => path.join(app.getPath('userData'), 'offline-resources.json');
const ACCEPTED_RESOURCE_STATES = new Set(['success', 'pending', 'duplicate', 'placement_failed', 'legacy_accepted', 'unverified']);
const resourceArchive = jsonStore ? new (require('./resource-archive').ResourceArchive)(path.join(app.getPath('userData'), 'resource-archive'), jsonStore) : null;
function getDatabaseResource(database, key) { return resourceArchive ? resourceArchive.get(database, key) : database.resources[key]; }
function databaseResourceEntries(database) { return resourceArchive ? resourceArchive.entries(database) : Object.entries(database.resources); }
let resourceDatabaseCache;
let resourceDatabaseSizeIndex;
let resourceDatabaseSizeGroups;
function writeResourceDatabase(database) {
  const target = RESOURCE_DATABASE_FILE(); fs.mkdirSync(path.dirname(target), { recursive: true });
  if (resourceArchive) resourceArchive.prune(database);
  if (jsonStore) jsonStore.set(target, database);
  else { fs.writeFileSync(target + '.tmp', JSON.stringify(database), 'utf8'); fs.renameSync(target + '.tmp', target); }
  resourceDatabaseCache = database;
}

function resourceDatabase() {
  if (resourceDatabaseCache) return resourceDatabaseCache;
  if (fs.existsSync(RESOURCE_DATABASE_FILE())) {
    try { resourceDatabaseCache = JSON.parse(fs.readFileSync(RESOURCE_DATABASE_FILE(), 'utf8')); }
    catch (_) { throw new Error('本地资源记录库无法读取，请保留 offline-resources.json 后检查文件；未覆盖旧记录'); }
    if (resourceDatabaseCache.version !== 1 || !resourceDatabaseCache.resources || !Array.isArray(resourceDatabaseCache.history)) { resourceDatabaseCache = undefined; throw new Error('本地资源记录库格式无效，未覆盖旧记录'); }
    let changed = false;
    for (const row of resourceDatabaseCache.history) {
      const resource = getDatabaseResource(resourceDatabaseCache, `${row.uid}|${magnetKey(row.url)}`);
      if (resource && !resource.movieId && row.movieId) { resource.movieId = String(row.movieId); resource.mode = row.mode; changed = true; }
    }
    if (changed) writeResourceDatabase(resourceDatabaseCache);
    return resourceDatabaseCache;
  }
  const config = readConfig();
  const database = { version: 1, resources: {}, history: (config.submitHistory || []).map(row => ({ ...row, id: row.id || crypto.randomUUID() })) };
  for (const row of database.history) if (row.uid && ACCEPTED_RESOURCE_STATES.has(row.status)) mergeDatabaseResource(database, row, row.status);
  const uid = String(config.monitorAccountUid || (loadCookie().match(/(?:^|;\s*)UID=(\d+)/) || [])[1] || '');
  for (const key of config.monitor?.seen || []) {
    const hash = String(key).match(/^magnet:([a-f0-9]{40}|[a-z2-7]{32})$/i)?.[1];
    const url = hash ? `magnet:?xt=urn:btih:${hash}` : /^ed2k:\/\//i.test(String(key)) ? String(key) : '';
    if (uid && url && !getDatabaseResource(database, `${uid}|${magnetKey(url)}`)) mergeDatabaseResource(database, { uid, url, source: 'auto' }, 'legacy_accepted');
  }
  for (const [selectionKey, best] of Object.entries(config.monitorMovieBest || {})) {
    for (const version of config.monitorSavedVersions?.[selectionKey] || [best]) if (uid && version.url) mergeDatabaseResource(database, { ...version, uid, source: 'auto', selectionKey, size: version.size, sizeGB: version.sizeGB, movieTitle: version.title }, 'legacy_accepted');
  }
  writeResourceDatabase(database); return database;
}
function mergeDatabaseResource(database, row, status) {
  if (!row.uid || !row.url) return;
  const key = `${row.uid}|${magnetKey(row.url)}`; const previous = getDatabaseResource(database, key);
  // 一次提交失败不能抹掉此前已接受的任务；真正的离线失败由后台核对单独更新。
  const accepted = ACCEPTED_RESOURCE_STATES.has(status);
  const resource = { ...(previous || {}), uid: String(row.uid), url: String(row.url), key: magnetKey(row.url), status: accepted || !previous ? status : previous.status, title: row.title || previous?.title || '', size: row.size || previous?.size || '', sizeGB: Number(row.sizeGB) || sizeInGb(row.size) || previous?.sizeGB || 0, updatedAt: new Date().toISOString(), associations: { ...(previous?.associations || {}) }, sources: [...new Set([...(previous?.sources || []), row.source].filter(Boolean))] };
  if (row.selectionKey) resource.associations[row.selectionKey] = { mode: row.mode || '', movieId: row.movieId || '', movieTitle: row.movieTitle || row.title || '', size: row.size || '', sizeGB: Number(row.sizeGB) || sizeInGb(row.size) };
  if (row.mode === 'tv' && row.movieId && Array.isArray(row.episodeKeys) && row.episodeKeys.length) {
    resource.episodeKeys = [...row.episodeKeys]; resource.movieId = String(row.movieId);
    const episodeSizeGB = Number(row.episodeSizeGB) || resource.sizeGB / row.episodeKeys.length;
    if(Object.keys(row.episodeSizes || {}).length && resource.episodeFiles?.hasFileList)for(const association of Object.keys(resource.associations))if(association.startsWith(`tv:${row.movieId}:S`) && !row.episodeKeys.includes(association.slice(`tv:${row.movieId}:`.length)))delete resource.associations[association];
    for (const episode of row.episodeKeys) resource.associations[`tv:${row.movieId}:${episode}`] = { mode: 'tv', movieId: String(row.movieId), sizeGB: Number(row.episodeSizes?.[episode]) || episodeSizeGB, estimated: !row.episodeSizes?.[episode] && row.episodeKeys.length > 1, episodeCount: row.episodeKeys.length, movieTitle: row.movieTitle || row.title || '' };
    if(row.episodeSizes)resource.episodeSizes={...row.episodeSizes};
  }
  if (row.movieId) { resource.movieId = String(row.movieId); resource.mode = row.mode || previous?.mode || ''; }
  for (const name of ['movieInfo','seedInfo','torrentInfo']) if (row[name]) resource[name] = {...resource[name],...row[name]};
  if (row.exportRecord) resource.exportRecord = mergeExportRecord(resource.exportRecord || {},row.exportRecord);
  database.resources[key] = resource;
  updateResourceSizeIndex(key, previous, resource);
}
function rememberResourceVersion(item, status = 'pending') {
  const uid = String(readConfig().monitorAccountUid || ''); if (!uid) return;
  const database = resourceDatabase(); const previous = getDatabaseResource(database, `${uid}|${magnetKey(item.url)}`); mergeDatabaseResource(database, { ...item, uid, source: 'auto' }, ACCEPTED_RESOURCE_STATES.has(previous?.status) ? previous.status : status); writeResourceDatabase(database);
}
function updateResourceSizeIndex(identity, previous, resource) {
  if (!resourceDatabaseSizeIndex || !resourceDatabaseSizeGroups) return;
  const groups = new Set([...Object.keys(previous?.associations || {}), ...Object.keys(resource?.associations || {})]);
  const uid = resource?.uid || previous?.uid;
  for (const key of groups) {
    const indexKey = `${uid}|${key}`;
    let group = resourceDatabaseSizeGroups.get(indexKey);
    if (!group) { group = new Map(); resourceDatabaseSizeGroups.set(indexKey, group); }
    group.delete(identity);
    if (resource && ACCEPTED_RESOURCE_STATES.has(resource.status) && !cloudNeedsFallback(uid,resource.url) && resource.associations?.[key]) group.set(identity, Number(resource.associations[key].sizeGB) || 0);
    resourceDatabaseSizeIndex.set(indexKey, Math.max(0, ...group.values()));
  }
}
function resourceDatabaseBestSize(selectionKey, uid) {
  const database = resourceDatabase();
  if (!resourceDatabaseSizeIndex) {
    resourceDatabaseSizeIndex = new Map(); resourceDatabaseSizeGroups = new Map();
    for (const [identity, resource] of databaseResourceEntries(database)) updateResourceSizeIndex(identity, null, resource);
  }
  return resourceDatabaseSizeIndex.get(`${uid}|${selectionKey}`) || 0;
}

function localCacheFile(name) { return path.join(app.getPath('userData'), name); }
function readLocalCache(name) { try { return JSON.parse(fs.readFileSync(localCacheFile(name),'utf8')); } catch { return null; } }
function writeLocalCache(name,data) { const file=localCacheFile(name);if(jsonStore)jsonStore.set(file,data);else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(data),'utf8');fs.renameSync(file+'.tmp',file);} }
const catalogDiskCache=new (require('./catalog-cache').CatalogCache)({read:()=>readLocalCache('catalog-cache.json'),write:data=>writeLocalCache('catalog-cache.json',data),limit:400});
let backgroundWindow;
const browseCache=new (require('./browse-cache').BrowseCache)({cache:catalogDiskCache,notify:value=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('browse-catalog-updated',value);},log:(site,error,phase)=>appendMonitorLog(phase==='cache'?'资源库已读取，本地浏览缓存暂未保存':'资源库后台更新失败，继续显示本地缓存','warning',error.message,site)});

const cloudDownloadCache=new (require('./cloud-download-cache').CloudDownloadCache)({read:()=>readLocalCache('cloud-download-state.json'),write:async data=>{writeLocalCache('cloud-download-state.json',data);if(jsonStore)await jsonStore.flush();notifySubmitHistoryUpdated();resourceDatabaseSizeIndex=null;resourceDatabaseSizeGroups=null;},account:()=>loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || '',page:page=>readOfflineTaskPage(loadCookie(),page),task:value=>readCachedOfflineTask(loadCookie(),value),key:magnetKey,stopped:()=>shuttingDown,interval:()=>cloudSyncPreferences().intervalMinutes*60000,lookbackHours:()=>cloudSyncPreferences().lookbackHours,enabled:()=>cloudSyncPreferences().enabled,onProgress:progress=>pushCloudDownloadProgress(progress),log:message=>appendMonitorLog(message,'info','','115')});
function cloudNeedsFallback(uid,url) { return Boolean(url && cloudDownloadCache.retryable(uid,url)); }
function cloudFallbackScope(movieId,uid) {
  const keys=new Set();for(const [,row] of databaseResourceEntries(resourceDatabase()))if(row.uid===uid && String(row.movieId)===String(movieId) && cloudNeedsFallback(uid,row.url))for(const key of Object.keys(row.associations || {}))keys.add(key);
  return keys;
}
function fallbackSeedFilters(seed,detail,filters,movieId,mode,scope) {
  if(!scope.size)return filters;
  const coverage=mode==='tv'?seedEpisodeCoverage(seed,detail):null;
  const affected=mode!=='tv' || coverage?.keys.some(key=>scope.has(`tv:${movieId}:${key}`)) || coverage?.opaque && scope.has(`tv:${movieId}:${coverage.selectionKey}`);
  return affected?{...filters,withinDays:0,withinMinutes:0,dateMode:'recent',startDate:'',endDate:''}:filters;
}
const cloudFallbackChecked=new Map();
async function scanLocalCloudFallbacks(website,filters,assertActive,onCandidates,categories=null) {
  const uid=String(readConfig().monitorAccountUid || ''),movies=new Map();
  for(const [,row] of databaseResourceEntries(resourceDatabase())) {
    const gy=String(row.movieId || '').startsWith('gy:');if(!row.movieId || row.uid!==uid || (row.website || (String(row.movieId).startsWith('qm5:')?'qmp4':String(row.movieId).startsWith('jy4:')?'jying':String(row.movieId).startsWith('bt3:')?'btbtla':gy?'guanying':'butailing'))!==website || !cloudNeedsFallback(uid,row.url))continue;
    if(categories && !categories.includes(String(row.movieId).split(':')[1]))continue;
    const info=row.movieInfo || {},knownYear=yearValue(info);if(knownYear && !yearMatches(knownYear,filters.years))continue;
    movies.set(String(row.movieId),{id:String(row.movieId),title:row.movieTitle || row.title || '',mode:row.mode || (gy ? String(row.movieId).startsWith('gy:mv:')?'movie':'tv' : Object.keys(row.associations || {}).some(key=>key.startsWith('tv:'))?'tv':'movie')});
  }
  for(const movie of movies.values()) {
    if(!require('./monitor-size-ranges').modeAllowed(filters,movie.mode))continue;
    const retryKey=`${website}|${uid}|${movie.id}`,retryStamp=JSON.stringify([cloudDownloadCache.data.accounts[uid]?.syncedAt,filters]);
    if(cloudFallbackChecked.get(retryKey)===retryStamp)continue;
    assertActive();appendMonitorLog(`本地云下载未完成，检查下一档：${movie.title}`,'info','只检查本地已知的对应影片，不扫描其他年份或全库。',website);
    const detail=await fetchMovieDetail(movie.id);assertActive();
    if(movie.mode==='tv')await inspectTelevisionFiles(movie,detail,filters,assertActive);
    const candidates=selectMonitorCandidates(movie.mode,movie,detail,filters).candidates;
    cloudFallbackChecked.set(retryKey,retryStamp);while(cloudFallbackChecked.size>20000)cloudFallbackChecked.delete(cloudFallbackChecked.keys().next().value);
    if(await onCandidates(candidates,false))break;
  }
}
function usableSavedBest(best,uid) { return cloudNeedsFallback(uid,best?.url) ? 0 : Number(best?.sizeGB || 0); }
function cloudSyncPreferences(){const value=readConfig().cloudDownloadSync || {};return {enabled:value.enabled!==false,lookbackHours:[24,48,168].includes(Number(value.lookbackHours))?Number(value.lookbackHours):24,intervalMinutes:Math.max(1,Math.min(10080,Math.round(Number(value.intervalMinutes)||60)))};}
const cloudSyncSchedule=new (require('./cloud-sync-schedule').CloudSyncSchedule)({state:()=>cloudDownloadProgressState(),sync:()=>syncCloudDownloads(),stopped:()=>shuttingDown});
function syncCloudDownloads(force=false,options) {return cloudDownloadCache.sync(force,options).then(async value=>{if(value)await repairCachedOfflinePlacements();return value;}).catch(error=>appendMonitorLog('115云下载同步失败，保留上次本地结果','warning',error.message,'115' )).finally(()=>cloudSyncSchedule.arm());}
const cloudSubmitSync=new (require('./cloud-submit-sync').CloudSubmitSync)({account:()=>loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1]||'',sync:()=>syncCloudDownloads(true,{checkOldTasks:false}),active:()=>cloudDownloadCache.running,stopped:()=>shuttingDown,setTimer:(fn,ms)=>setTimeout(fn,ms),clearTimer:id=>clearTimeout(id),log:message=>appendMonitorLog(message,'info','','115')});

function readConfig() {
  if (!jsonStore) {
    const target = CONFIG_FILE();
    let raw;
    try { raw = fs.readFileSync(target, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    try { return JSON.parse(raw); }
    catch (error) { throw new Error('配置文件无法读取，已保留原文件：' + error.message); }
  }
  const target = CONFIG_FILE();
  if (configCache && Date.now() - configCheckedAt < 1000) return configCache;
  configCheckedAt = Date.now();
  if (configCache && jsonStore.dirty(target)) return configCache;
  let mtime = 0; try { mtime = fs.statSync(target).mtimeMs; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!configCache || mtime !== configDiskMtime) {
    try { configCache = mtime ? JSON.parse(fs.readFileSync(target, 'utf8')) : {}; }
    catch (error) { throw new Error('配置文件无法读取，已保留原文件：' + error.message); }
    configDiskMtime = mtime;
  }
  return configCache;
}
function writeConfig(config) {
  if (jsonStore) { configCache = config; jsonStore.set(CONFIG_FILE(), config); return; }
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2), 'utf8');
}
const SITE_MIRRORS = Array.from({ length: 10 }, (_, index) => `https://www.${index}bt0.com`);
function mirrorConfig() {
  const saved = readConfig().mirrors || {};
  return { current: SITE_MIRRORS.includes(saved.current) ? saved.current : SITE, autoSwitch: saved.autoSwitch !== false, sites: SITE_MIRRORS };
}
function setMirror(current, autoSwitch = mirrorConfig().autoSwitch, reason = '手动选择') {
  if (!SITE_MIRRORS.includes(current)) throw new Error('请选择列表中的不太灵镜像');
  const config = readConfig(); const previous = mirrorConfig().current;
  config.mirrors = { current, autoSwitch: Boolean(autoSwitch) }; writeConfig(config);
  if (typeof datedCatalogCache !== 'undefined') datedCatalogCache.clear();
  if (typeof resourceRequestCache !== 'undefined') resourceRequestCache.clear();
  const state = mirrorConfig();
  if (previous !== current) appendMonitorLog(`不太灵镜像切换：${new URL(previous).hostname} → ${new URL(current).hostname}`, 'info', reason);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mirror-status', { ...state, reason });
  return state;
}
let resourceQueue = Promise.resolve();
let nextResourceRequest = 0;
const resourceRequestCache = new Map();
const resourceInflight = new Map();
const waitResource = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function connectionMessage(error) {
  const cause = error.cause || {};
  return [error.name === 'TimeoutError' ? '请求超时' : error.message, cause.code, cause.message].filter(Boolean).join(' · ');
}
function queuedResourceRequest(task) {
  const pending = resourceQueue.then(async () => {
    await waitResource(Math.max(0, nextResourceRequest - Date.now()));
    try { return await task(); } finally { const interval = Math.max(1000, Math.min(60000, Number(readConfig().resourceRequestIntervalMs) || 3000)); nextResourceRequest = Math.max(nextResourceRequest, Date.now() + interval); }
  });
  resourceQueue = pending.catch(() => {});
  return pending;
}
function cachedResourceRequest(pathAndQuery, options) {
  const key = JSON.stringify([mirrorConfig().current,pathAndQuery, loadSiteSession().token]);
  const ttl=/detail|seed/i.test(pathAndQuery)?900000:180000;
  const cached = resourceRequestCache.get(key);
  if (!options?.fresh && cached && Date.now() - cached.time < 180000) { resourceRequestCache.delete(key); resourceRequestCache.set(key, cached); return Promise.resolve(cached.value); }
  if (cached) resourceRequestCache.delete(key);
  const disk=!options?.fresh && catalogDiskCache.get(key,ttl);if(disk)return Promise.resolve(disk);
  if (resourceInflight.has(key)) return resourceInflight.get(key);
  const pending = queuedResourceRequest(() => requestWithMirrors(pathAndQuery, options)).then(value => {
    if (value.success && Number(value.code) === 200) {
      for (const [oldKey, entry] of resourceRequestCache) if (Date.now() - entry.time >= 180000) resourceRequestCache.delete(oldKey);
      while (resourceRequestCache.size >= 6000) resourceRequestCache.delete(resourceRequestCache.keys().next().value);
      resourceRequestCache.set(key, { time: Date.now(), value }); catalogDiskCache.set(key,value);
    }
    return value;
  }).finally(() => resourceInflight.delete(key));
  resourceInflight.set(key, pending); return pending;
}
async function requestMirror(origin, pathAndQuery, options = {}) {
  if (shuttingDown) throw Object.assign(new Error('软件正在退出，已停止网站请求'), { noMirrorRetry:true, monitorCancelled:true });
  const parsed = new URL(pathAndQuery, origin);
  const headers = { 'User-Agent': 'Mozilla/5.0', ...(options.headers || {}) };
  for (const name of Object.keys(headers)) if (/^(authorization|cookie)$/i.test(name)) delete headers[name];
  parsed.searchParams.delete('access_token');
  const saved = loadSiteSession();
  if (saved.token && saved.host === new URL(origin).hostname) { headers.Authorization = `Bearer ${saved.token}`; parsed.searchParams.set('access_token', saved.token); }
  const jar = await session.fromPartition('persist:cloudsave').cookies.get({ url: origin }).catch(() => []);
  const cookie = jar.map(item => `${item.name}=${item.value}`).join('; ') || (saved.host === new URL(origin).hostname ? saved.cookie : '');
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(parsed.toString(), { ...options, headers, signal: AbortSignal.timeout(8000), redirect: 'manual' });
  if (response.status === 429) {
    const retry = response.headers.get('retry-after') || '';
    const delay = /^\d+$/.test(retry) ? Number(retry) * 1000 : (Date.parse(retry) - Date.now());
    throw Object.assign(new Error('HTTP 429：资源网站限制了请求频率'), { noMirrorRetry: true, rateLimited: true, retryMs: Math.max(30000, Math.min(120000, delay || 30000)) });
  }
  if (response.status === 401 || response.status === 403) throw Object.assign(new Error('不太灵登录失效或访问受限，请在当前镜像重新登录'), { noMirrorRetry: true });
  if (response.status >= 300 && response.status < 400 && /login|signin/i.test(response.headers.get('location') || '')) throw Object.assign(new Error('请在当前不太灵镜像重新登录'), { noMirrorRetry: true });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = JSON.parse(await response.text());
  return data;
}
async function requestWithMirrors(pathAndQuery, options = {}, force = false) {
  const state = mirrorConfig();
  const sites = [state.current, ...state.sites.filter(origin => origin !== state.current)];
  const allowed = force || state.autoSwitch ? sites : sites.slice(0, 1);
  for (const origin of allowed) {
    try {
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { result = await requestMirror(origin, pathAndQuery, options); break; }
        catch (error) {
          if (error.rateLimited) {
            nextResourceRequest = Math.max(nextResourceRequest, Date.now() + error.retryMs);
            appendMonitorLog('资源接口限流，暂停后重试', 'warning', `${new URL(origin).hostname} · 等待 ${Math.ceil(error.retryMs / 1000)} 秒`);
            if (attempt === 0) { await waitResource(error.retryMs); continue; }
          }
          if (attempt === 0 && origin === state.current && !error.noMirrorRetry) { await waitResource(2000); continue; }
          throw error;
        }
      }
      if (origin !== state.current && (!result.success || Number(result.code) !== 200)) throw Object.assign(new Error(result.message || '镜像接口未返回有效资源'), { noMirrorRetry: [401,403].includes(Number(result.code)) || /登录|login|token/i.test(result.message || '') });
      if (origin !== mirrorConfig().current) setMirror(origin, mirrorConfig().autoSwitch, '原镜像连接或接口异常，自动切换到可用镜像');
      return result;
    } catch (error) {
      if (error.noMirrorRetry) throw error;
      appendMonitorLog(`不太灵镜像请求失败：${new URL(origin).hostname}`, 'warning', connectionMessage(error));
    }
  }
  throw Object.assign(new Error(state.autoSwitch || force ? '不太灵镜像均暂时不可用，请稍后重试或在设置中手动选择镜像' : '当前不太灵镜像不可用，请启用自动切换或手动选择镜像'), { mirrorsExhausted: true });
}
function loadCookie() {
  const config = readConfig();
  if (!config.cookie) return '';
  try {
    return decryptSecret(config.cookie);
  } catch { return ''; }
}
function saveCookie(cookie) {
  const previousUid = (loadCookie().match(/(?:^|;\s*)UID=(\d+)/) || [])[1];
  const nextUid = (String(cookie).match(/(?:^|;\s*)UID=(\d+)/) || [])[1];
  const config = readConfig();
  if (previousUid && nextUid && previousUid !== nextUid && config.folder) config.folder.requiresReselect = true;
  config.cookie = encryptSecret(cookie);
  writeConfig(config);
}
let plaintextSecretWarned = false;
function encryptSecret(value) {
  const text = String(value || '');
  if (portableStorage) return portableStorage.encrypt(text);
  if (!safeStorage.isEncryptionAvailable()) {
    if (!plaintextSecretWarned) { plaintextSecretWarned = true; appendMonitorLog('系统密钥库不可用，本次起登录凭据以明文保存，建议尽快在设置中重新登录', 'warning'); }
    return text;
  }
  return safeStorage.encryptString(text).toString('base64');
}
function decryptSecret(value) {
  if (!value) return '';
  if (portableStorage) { try { return portableStorage.decrypt(value); } catch { return ''; } }
  try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(value, 'base64')) : String(value); } catch { return ''; }
}
function saveCredentials(provider, account, password) {
  const config = readConfig();
  const existing = config.credentials && (config.credentials.account || config.credentials.password)
    ? { '115': config.credentials } : (config.credentials || {});
  existing[provider] = { account: encryptSecret(account), password: encryptSecret(password) };
  config.credentials = existing;
  writeConfig(config);
  return { account: String(account || ''), hasPassword: Boolean(password) };
}
function loadCredentials(provider = '115') {
  const config = readConfig();
  const saved = provider === '115' && (config.credentials?.account || config.credentials?.password) ? config.credentials : config.credentials?.[provider];
  return { account: decryptSecret(saved?.account), hasPassword: Boolean(saved?.password) };
}
function normalizeSiteToken(raw) {
  let token = String(raw || '').trim();
  if (/^Bearer\s+/i.test(token)) token = token.slice(7).trim();
  if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1).trim();
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !part || !/^[A-Za-z0-9_-]+$/.test(part))) return '';
  return token;
}
function loadSiteSession() {
  const config = readConfig();
  const saved = config.siteSession || {};
  return { token: normalizeSiteToken(decryptSecret(saved.token)), host: String(saved.host || ''), cookie: decryptSecret(saved.cookie) };
}
function saveSiteSession(token, host = '', cookie = '') {
  const config = readConfig();
  const normalized = normalizeSiteToken(token);
  config.siteSession = { token: encryptSecret(normalized), host: String(host || ''), cookie: encryptSecret(cookie) };
  writeConfig(config);
  return { loggedIn: Boolean(token) };
}

function normalizeCookie(raw) { return share115Api.normalizeCookie(raw); }

function monitorConfig(config = readConfig()) {
  const savedFilters = config.monitor?.filters && typeof config.monitor.filters === 'object' ? config.monitor.filters : {};
  return {
    enabled: Boolean(config.monitor?.enabled),scanOnly:Boolean(config.monitor?.scanOnly),autoSubmit:!config.monitor?.scanOnly&&config.monitor?.autoSubmit!==false,
    intervalMinutes: Math.max(5, Math.min(1440, Number(config.monitor?.intervalMinutes) || 15)),
    seen: Array.isArray(config.monitor?.seen) ? config.monitor.seen : [],
    lastRun: config.monitor?.lastRun || '',
    lastMessage: config.monitor?.lastMessage || '自动监控未开启',
    saved: Number(config.monitor?.saved) || 0,
    failureStreak: Number(config.monitor?.failureStreak) || 0,
    nextRetryAt: config.monitor?.nextRetryAt || '',
    filterBlockedSignature: config.monitor?.filterBlockedSignature || '',
    nextFilterProbeAt:config.monitor?.nextFilterProbeAt || '',filterProbeLastAt:config.monitor?.filterProbeLastAt || '',filterBlockedProbe:config.monitor?.filterBlockedProbe || null,
    logs: Array.isArray(config.monitor?.logs) ? config.monitor.logs : [],
    coverageReview: Array.isArray(config.monitorCoverageReview) ? config.monitorCoverageReview.filter(row=>!String(row.movieId || '').startsWith('gy:') && (!row.uid || row.uid===String(config.monitorAccountUid || loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || ''))) : [],
    filters: {
      genres: Array.isArray(savedFilters.genres) ? savedFilters.genres.filter(Boolean) : [],
      countries: Array.isArray(savedFilters.countries) ? savedFilters.countries.filter(Boolean) : [],
      years: Array.isArray(savedFilters.years) ? savedFilters.years.filter(Boolean) : [],
      qualities: Array.isArray(savedFilters.qualities) ? savedFilters.qualities.filter(Boolean) : [],
      tags: Array.isArray(savedFilters.tags) ? savedFilters.tags.filter(Boolean) : [],
      sort: String(savedFilters.sort || '更新时间'),
      scoreRange: String(savedFilters.scoreRange || ''),
      onlyImdb: Boolean(savedFilters.onlyImdb),
      onlyCloud: Boolean(savedFilters.onlyCloud),
      compareSize: savedFilters.compareSize !== false,saveModes:require('./monitor-size-ranges').saveModes(savedFilters.saveModes),
      sizeRanges:require('./monitor-size-ranges').normalizeSizeRanges(savedFilters),minSizeGB: Number(savedFilters.minSizeGB) || 0,
      maxSizeGB: Number(savedFilters.maxSizeGB) || 0,
      withinDays: Number(savedFilters.withinDays) || 0, withinMinutes:Number(savedFilters.withinMinutes)||60,
      dateMode: String(savedFilters.dateMode || 'recent'), startDate: String(savedFilters.startDate || ''), endDate: String(savedFilters.endDate || ''),
      maxItems: normalizeMonitorLimit(savedFilters.maxItems)
    }
  };
}
function saveMonitor(patch) {
  const config = readConfig();
  config.monitor = { ...monitorConfig(config), ...patch };
  writeConfig(config);
  return config.monitor;
}
function normalizeMonitorLimit(value) {
  const number=Number(value);
  return Number.isFinite(number) && number>0 ? Math.min(Number.MAX_SAFE_INTEGER,Math.max(1,Math.floor(number))) : 30;
}
function appendMonitorLog(message, level = 'info', details = '', website = 'butailing') {
  const entry = { time: new Date().toISOString(), source: 'cloudsave_monitor', website, level, message: publicSubmissionFeedback(message), details: publicSubmissionFeedback(details) };
  const config = readConfig();
  const state = monitorConfig(config);
  const logs = [...state.logs, entry].slice(-500);
  try { if(typeof fs.appendFileSync==='function'){const file=monitorLogFile();fs.mkdirSync(path.dirname(file),{recursive:true});fs.appendFileSync(file,JSON.stringify(entry)+'\n','utf8');try{require('./monitor-log-files').retention(fs,file);}catch{ /* 清理是附带工作，失败不影响本条日志 */ }} } catch(error) { entry.details+=`\n完整日志写入失败：${error.message}`; }
  config.monitor = { ...state, logs }; writeConfig(config);
  pushMonitorStatus({ ...state, logs });
}
function monitorLogFile() {return path.join(app.getPath('userData'),'logs',`monitor-${new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'})}.jsonl`);}
function completeMonitorLogText() {
  let entries=monitorConfig().logs;
  if(fs.existsSync(monitorLogFile()))entries=String(fs.readFileSync(monitorLogFile(),'utf8')).split(/\r?\n/).filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch(_){return [];}});
  return entries.map(entry=>`${new Date(entry.time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} - ${({guanying:'观影',btbtla:'BT影视',jying:'聚影',qmp4:'七味','115':'115云下载','share115':'115分享监控','123':'123云盘'}[entry.website]||'不太灵') + ' / ' + (entry.source || 'cloudsave_monitor')} - ${String(entry.level || 'info').toUpperCase()} - ${publicSubmissionFeedback(entry.message)}${entry.details?'\n'+publicSubmissionFeedback(entry.details):''}`).join('\n');
}
function submitHistory() {
  const database=resourceDatabase(),config=readConfig(),resolved=config.offlinePlacementResolved||{},legacy=Array.isArray(config.submitHistory)?config.submitHistory:[];let changed=false;
  for(const row of database.history){if(row.status!=='success'||resolved[`${row.uid}|${magnetKey(row.url)}`]?.resolution!=='unavailable')continue;row.status='unverified';row.message='115已完成下载；原输出已被整理、移动或删除，结束目录核对（未核实当前位置）';const old=legacy.find(item=>row.id?item.id===row.id:item.uid===row.uid&&magnetKey(item.url)===magnetKey(row.url));if(old){old.status='unverified';old.message=row.message;}changed=true;}
  if(changed){writeResourceDatabase(database);config.submitHistory=legacy;writeConfig(config);}
  return database.history;
}
function notifySubmitHistoryUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('submit-history-updated');
}
function recordSubmitHistory(url, status, message, cid, context = {}) {
  const config = readConfig();
  const row = { website:context.website || (String(context.movieId || '').startsWith('gy:')?'guanying':'butailing'), id: crypto.randomUUID(), time: new Date().toISOString(), url: String(url || ''), status: String(status || 'unknown'), message: String(message || ''), cid: String(cid ?? ''), source: ['auto', 'manual', 'batch'].includes(context.source) ? context.source : 'manual', title: String(context.title || '').slice(0, 500), folderName: String(context.folderName || ''), uid: String(context.uid || ''), selectionKey: String(context.selectionKey || ''), movieId: String(context.movieId || ''), mode: String(context.mode || ''), size: String(context.size || ''), sizeGB: sizeInGb(context.size), episodeKeys: Array.isArray(context.episodeKeys) ? context.episodeKeys : [], episodeSizeGB: Number(context.episodeSizeGB) || 0, episodeSizes:{...(context.episodeSizes || {})}, sizeSource:context.sizeSource || '' };
  const database = resourceDatabase();
  const exportRecord = context.exportRecord || scanExportTools().exportRow({url:row.url,title:row.title,size:row.size,date:context.date || context.raw?.ezt || context.raw?.eztime,raw:context.raw || {id:context.seedId}}, {...normalizeMovie(context.movieInfo || {}),id:row.movieId});
  row.exportRecord = exportRecord;
  database.history.push(row); mergeDatabaseResource(database, {...row,movieInfo:context.movieInfo,seedInfo:context.raw}, row.status); writeResourceDatabase(database);
  config.submitHistory = [...(Array.isArray(config.submitHistory) ? config.submitHistory : []), row].slice(-500);
  writeConfig(config);
  notifySubmitHistoryUpdated(); queueMetadataCapture(row.uid,magnetKey(row.url)); return row;
}

function magnetKey(url) {
  const value = String(url || '').trim();
  const hash = value.match(/xt=urn:btih:([^&]+)/i)?.[1];
  return hash ? `magnet:${offlineHash(value) || hash.toLowerCase()}` : value.toLowerCase();
}

function originalMovieUrl(raw, id) {
  if(String(id || '').startsWith('qm5:')){try{const u=new URL(raw || '', 'https://www.qmp4.com');if(u.origin==='https://www.qmp4.com'&&/^\/mv\/\d+\.html$/.test(u.pathname))return u.href;}catch(_){}return '';}
  if(String(id || '').startsWith('jy4:')){try{const url=new URL(raw || '', 'https://jying.top');if(['https://jying.top','https://www.jying.top'].includes(url.origin)&&/^\/movie\/\d+$/.test(url.pathname))return url.href;}catch(_){}return '';}
  if(String(id || '').startsWith('bt3:')){try{const url=new URL(raw || '', 'https://www.btbtla.com');if(url.origin==='https://www.btbtla.com'&&/^\/(detail|tdown)\/\d+\.html$/.test(url.pathname))return url.href;}catch(_){}return '';}
  if (String(id || '').startsWith('gy:')) { try { const provider=require('./guanying-provider'); const url=new URL(raw || provider.pathFromId(id),provider.ORIGIN);if(url.origin===provider.ORIGIN && /^\/(mv|tv|ac)\/[a-z0-9]+$/i.test(url.pathname))return url.href; }catch(_){} return ''; }
  const origin = mirrorConfig().current;
  try {
    const url = new URL(String(raw || ''), origin);
    if (SITE_MIRRORS.includes(url.origin) && url.pathname !== '/' && /^https?:$/.test(url.protocol)) return origin + url.pathname + url.search + url.hash;
  } catch (_) {}
  return /^\d+$/.test(String(id || '')) ? `${origin}/mv/${id}` : '';
}

function normalizeMovie(item = {}) {
  return {
    mediaType:item.kind || '',
    website: item.website || (String(item.doub_id || item.id || '').startsWith('gy:') ? 'guanying' : 'butailing'),
    id: String(item.doub_id || item.idcode || String(item.aurl1 || '').match(/\/mv\/(\d+)/)?.[1] || item.id || ''),
    title: String(item.title || ''),
    webUrl: originalMovieUrl(item.aurl1 || item.detail_url || item.link || item.url, item.doub_id || item.idcode || item.id),
    poster: String(item.epic || item.image || item.pica || ''),
    year: String(item.niandai || item.years || ''),
    score: String(item.edbf || item.doub_score || item.score || ''),
    alias: String(item.alias || ''),
    genre: String(item.class || item.genre || item.genres || ''),
    country: String(item.production_area || item.country || item.countries || ''),
    director: String(item.director || item.daoyan || ''),
    writer: String(item.writer || item.screenwriter || item.bianju || item['编剧'] || ''),
    cast: String(item.performer || item.yanyuan || ''),
    language: String(item.language || item.yuyan || ''),
    releaseDate: String(item.release || item.release_date || item.releaseDate || item.shangying || item.pubdate || ''),
    intro: String(item.abstract || item.conta || ''),
    updateText: String(item.ejs || item.episode || item.episodes || ''),
    magnetCount: Number(item.seed_num || item.znum || 0) || 0,
    cloudCount: Number(item.wp_num || item.pan_num || 0) || 0,
    cloudCountKnown: item.wp_num != null || item.pan_num != null,
    magnetCountKnown: item.seed_num != null || item.znum != null,
    imdb: String(item.IMDB_number || ''),
    imdbKnown: item.IMDB_number != null,
    votes: String(item.doub_votes || item.doub_score_peo_num || item.doub_num || ''),
    seedUrl: String(item.zlink || item.magnet || item.url || '').trim(),
    seedSize: String(item.zsize || ''),
    seedId: item.zlink ? String(item.id || '') : '',
    seedRaw: item.zlink ? item : undefined,
    seedDate: String(item.ezt || item.eztime || ''),
    seedUpdatedAt: String(item.seed_updated_at || '')
  };
}

const datedCatalogCache = new Map();
async function fetchDatedCatalog(mode, page, filters) {
  validateUpdateTimeFilter(filters);
  const key = JSON.stringify([mode, filters, loadSiteSession().token || '']);
  let entry = datedCatalogCache.get(key);
  if (!entry || (entry.done && Date.now() - entry.time > 300000)) {
    const promise = (async () => {
      const found = [];
      const base = { ...filters, withinDays: 0, withinMinutes:0, dateMode:'recent', startDate: '', endDate: '', strictCatalog: true };
      let pages = 1; let reachedDateBoundary = false;
      const lowerBound = require('./monitor-time').scanLowerBound(filters);
      for (let index = 1; index <= pages; index++) {
        const data = await fetchCloudCatalog(mode, index, base);
        pages = Math.max(1, Math.ceil(data.total / data.limit));
        for (const movie of data.items) {
          if (movie.seedDate) { if (matchesUpdateTime(movie.seedDate, filters)) found.push(movie); continue; }
          const detail = await fetchCloudDetail(movie.id);
          const updated = resourceTime(detail.movie.seedUpdatedAt);
          if (['movie', 'tv'].includes(mode) && lowerBound && updated && updated < lowerBound) { reachedDateBoundary = true; break; }
          if ([...detail.seeds, ...detail.clouds].some(item => matchesUpdateTime(item.date, filters))) found.push(movie);
        }
        if (reachedDateBoundary || !data.items.length) break;
      }
      return found;
    })();
    entry = { time: Date.now(), promise, done: false };
    promise.then(() => { entry.done = true; entry.time = Date.now(); }, () => {});
    datedCatalogCache.clear(); datedCatalogCache.set(key, entry);
    promise.catch(() => { if (datedCatalogCache.get(key) === entry) datedCatalogCache.delete(key); });
  }
  const items = await entry.promise;
  return { page, total: items.length, limit: 20, items: items.slice((page - 1) * 20, page * 20) };
}
const nativeYearScopeCache=new Map();
function nativeYearBatchCompatible(batch,requestedYear){
  const scope=batch.nativeYearScope,year=Number(requestedYear);
  return Boolean(scope && String(scope.requestedYear)===String(requestedYear) && scope.alias==='近三年' && scope.min<=year && year<=scope.max && scope.max-scope.min<=5 && batch.items.every(item=>!yearValue(item)||(yearValue(item)>=scope.min&&yearValue(item)<=scope.max)));
}
async function resolveNativeYearScope(year){
  const types=await apiRequest(`${mirrorConfig().current}/prod/api/v1/getVideoTypeList?${new URLSearchParams(SITE_PARAMS)}`);
  const rows=types.data?.t3 || [],rule=rows.find(row=>String(row.title)===String(year));let blank=false;
  try {const values=JSON.parse(rule?.thesaurus || 'null');blank=Array.isArray(values)&&values.length>0&&values.every(row=>!row.value&&!row.key);}catch(_){}
  if(!blank)return null;
  const range=rows.find(row=>row.title==='近三年'),bounds=String(range?.thesaurus || '').match(/@(\d{4})-(\d{4})$/);
  if(!bounds)return null;const min=Number(bounds[1]),max=Number(bounds[2]);
  return min<=Number(year)&&Number(year)<=max&&max-min<=5?{requestedYear:String(year),alias:range.title,min,max}:null;
}
async function fetchCloudCatalog(mode = 'movie', page = 1, filters = {}) {
  if (hasUpdateTimeFilter(filters)) return fetchDatedCatalog(mode, page, filters);
  const hotMode = { hotday: 3, hotweek: 4, hotmonth: 5 }[mode];
  const latest = mode === 'latest' || Boolean(hotMode);
  const args = latest
    ? { ...SITE_PARAMS, sc: String(hotMode || filters.latestMode || 1), page: String(page) }
    : { ...SITE_PARAMS, sa: mode === 'tv' ? '2' : '1', sg: '1', page: String(page) };
  if(!latest){args.sg=({'更新时间':'1','资源更新时间':'1','添加时间':'3','上映时间':'4','评分最高':'5','评分人数':'6'})[filters.sort] || (['1','3','4','5','6'].includes(String(filters.sort))?String(filters.sort):'1');args.pfrs=String(Math.max(0,Math.round(Number(filters.minVotes || filters.pfrs)||0)));const score=String(filters.scoreRange || '').match(/^(\d+(?:\.\d+)?)[x-](\d+(?:\.\d+)?)$/);args.pfqj=score?score[1]+'x'+score[2]:'0x10';args.imdb=filters.onlyImdb?'1':'0';args.iswp=filters.onlyCloud?'1':'0';if(mode==='tv'&&['更新中','已完结'].includes(filters.status))args.status=filters.status;for(const [key,param] of Object.entries({genres:'sct',countries:'sdt',years:'set',qualities:'sft',tags:'sht'}))if(filters[key+'Custom'])args[param]=String(filters[key+'Custom']);}
  const filterKeys = { genres: 'sc', countries: 'sd', years: 'se', qualities: 'sf', tags: 'sh' };
  for (const [key, value] of Object.entries(filters || {})) if (!latest && value && filterKeys[key]) args[filterKeys[key]] = String(value);
  const scopeKey=`${mirrorConfig().current}|${mode}|${filters.years}`,cachedScope=filters.strictCatalog?nativeYearScopeCache.get(scopeKey):null;
  let nativeYearScope=cachedScope && Date.now()-cachedScope.time<600000?cachedScope.scope:null;
  if(nativeYearScope)args.se=nativeYearScope.alias;
  const endpoint = latest ? 'getTList' : 'getVideoMovieList';
  let result;
  try {
    result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/${endpoint}?${new URLSearchParams(args)}`,{fresh:Boolean(filters.probeFresh)});
    if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '资源库接口返回失败');
  }
  catch (error) {
    if (filters.strictCatalog || error.noMirrorRetry || error.mirrorsExhausted) throw error;
    // 资源站偶尔会让分类/搜索接口返回“Unmatched '}'”。使用最新资源接口作为可用降级，保证资源库仍能浏览。
    const fallbackMode = latest ? String(hotMode || filters.latestMode || 1) : (mode === 'tv' ? '2' : '1');
    result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/getTList?${new URLSearchParams({ ...SITE_PARAMS, sc: fallbackMode, page: String(page) })}`);
    result.__fallbackMessage = error.message;
  }
  if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '资源库接口返回失败');
  let data=result.data || {},list=Array.isArray(data.list)?data.list:(Array.isArray(data.data)?data.data:[]);
  const exactYear=filters.strictCatalog && !latest && /^\d{4}$/.test(String(filters.years || ''));
  const mismatch=()=>list.some(item=>item.niandai && String(item.niandai)!==String(filters.years));
  if(exactYear && mismatch() && !nativeYearScope){
    try {nativeYearScope=await resolveNativeYearScope(filters.years);}catch(_){}
    if(nativeYearScope){
      const compatibleArgs={...args,se:nativeYearScope.alias};
      const compatible=await apiRequest(`${mirrorConfig().current}/prod/api/v1/${endpoint}?${new URLSearchParams(compatibleArgs)}`,{fresh:Boolean(filters.probeFresh)});
      if(!compatible.success || Number(compatible.code)!==200)throw new Error(compatible.message || '近期年份范围读取失败');
      result=compatible;data=result.data || {};list=Array.isArray(data.list)?data.list:(Array.isArray(data.data)?data.data:[]);
    }
  }
  const limit=Number(data.limit || list.length || 20)||20;
  const items=list.map(item=>normalizeMovie(latest || result.__fallbackMessage?{...item,title:item.title || item.zname,doub_id:item.doub_id || item.idcode || String(item.aurl1 || '').match(/\/mv\/(\d+)/i)?.[1]}:item)).filter(item=>item.id || item.title);
  const batch={page:Number(page)||1,total:Number(data.total || list.length)||list.length,limit,fallback:result.__fallbackMessage || '',items,...(nativeYearScope?{nativeYearScope}: {})};
  if(exactYear && ((nativeYearScope && !nativeYearBatchCompatible(batch,filters.years)) || (!nativeYearScope && mismatch()))){
    nativeYearScopeCache.delete(scopeKey);
    const samples=list.filter(item=>item.niandai && String(item.niandai)!==String(filters.years)).slice(0,3).map(item=>`${item.title || item.doub_id} (${item.niandai})`).join('、');
    throw Object.assign(new Error(`网站接口未按年份 ${filters.years} 返回资源，且没有可验证的有限年份范围；返回示例：${samples}；已停止扫描，避免退回全库`),{filterRejected:true,noMirrorRetry:true,catalogProbe:{mode,filters:Object.fromEntries(Object.entries(filters).filter(([key])=>key!=='probeFresh'))}});
  }
  if(nativeYearScope){
    if(!cachedScope || Date.now()-cachedScope.time>=600000)appendMonitorLog(`年份筛选兼容：官网 ${filters.years} 精确年份规则为空，使用官网${nativeYearScope.alias}范围 ${nativeYearScope.min}—${nativeYearScope.max}`,'warning',`仅在此有限年份范围读取列表；${filters.years} 以外的影片在请求详情前跳过，继续按更新时间和数量限制扫描。没有退回全库。`);
    if(nativeYearScopeCache.size>=32)nativeYearScopeCache.delete(nativeYearScopeCache.keys().next().value);
    nativeYearScopeCache.set(scopeKey,{time:cachedScope && Date.now()-cachedScope.time<600000?cachedScope.time:Date.now(),scope:nativeYearScope});
  }
  return batch;
}

async function fetchCloudSearch(query, page = 1) {
  const args = { ...SITE_PARAMS, sb: String(query || ''), page: String(page) };
  let result;
  try {
    result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/getVideoList?${new URLSearchParams(args)}`);
    if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '影片搜索接口返回失败');
  }
  catch (_) {
    const batches = await Promise.all([1, 2].map(mode => apiRequest(`${mirrorConfig().current}/prod/api/v1/getTList?${new URLSearchParams({ ...SITE_PARAMS, sc: String(mode), page: String(page) })}`)));
    const needle = String(query || '').toLowerCase();
    const fallbackItems = batches.flatMap(item => Array.isArray(item.data?.list) ? item.data.list : []).filter(item => String(item.title || item.zname || '').toLowerCase().includes(needle));
    return { page: Number(page) || 1, total: fallbackItems.length, limit: fallbackItems.length || 20, fallback: '当前站点搜索接口异常，已在最新资源中匹配', items: fallbackItems.map(item => normalizeMovie({ ...item, title: item.title || item.zname, doub_id: item.doub_id || item.idcode || String(item.aurl1 || '').match(/\/mv\/(\d+)/i)?.[1] })) };
  }
  if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '影片搜索接口返回失败');
  const data = result.data || {};
  const list = Array.isArray(data.list) ? data.list : (Array.isArray(data.data) ? data.data : []);
  const limit = Number(data.limit || list.length || 20) || 20;
  return { page: Number(page) || 1, total: Number(data.total || list.length) || list.length, limit, items: list.map(normalizeMovie).filter(item => item.id || item.title) };
}

async function fetchCloudFilters() {
  const result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/getVideoTypeList?${new URLSearchParams(SITE_PARAMS)}`);
  if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '筛选项获取失败');
  const data = result.data || {};
  const pick = key => Array.isArray(data[key]) ? data[key].map(item => typeof item === 'string' ? item : String(item.title || item.name || '')).filter(Boolean) : [];
  return { genres: pick('t1'), countries: pick('t2'), years: pick('t3'), qualities: pick('t4'), tags: pick('t5'),sorts:[{value:'1',label:'更新时间'},{value:'3',label:'添加时间'},{value:'4',label:'上映时间'},{value:'5',label:'评分最高'},{value:'6',label:'评分人数'}],statuses:['更新中','已完结'] };
}

function normalizeCloudDetail(data = {}) {
  const movie = normalizeMovie(data);
  const seeds = [];
  const groups = data.ecca && typeof data.ecca === 'object' ? data.ecca : {};
  for (const [group, list] of Object.entries(groups)) for (const item of Array.isArray(list) ? list : []) {
    const url = String(item.zlink || item.url || '').trim();
    if (/^(magnet:\?|ed2k:\/\/)/i.test(url)) seeds.push({ title: String(item.zname || item.title || group), url, size: String(item.zsize || ''), quality: String(item.zqxd || item.quality || group), date: String(item.ezt || item.eztime || ''), raw: item });
  }
  for (const item of Array.isArray(data.all_seeds) ? data.all_seeds : []) {
    const url = String(item.zlink || item.url || '').trim();
    if (/^(magnet:\?|ed2k:\/\/)/i.test(url)) seeds.push({ title: String(item.zname || item.title || ''), url, size: String(item.zsize || ''), quality: String(item.zqxd || item.quality || ''), date: String(item.ezt || item.eztime || ''), raw: item });
  }
  const clouds = [];
  const cloudGroups = data.movies_online_seed && typeof data.movies_online_seed === 'object' ? data.movies_online_seed : {};
  for (const [group, list] of Object.entries(cloudGroups)) for (const item of Array.isArray(list) ? list : []) {
    const url = String(item.link || item.url || '').trim();
    const qmpCloud=data.website==='qmp4'||group==='七味',rawTitle=String(item.seed_name || item.title || ''),description=qmpCloud?require('./cloud-update-description').cloudUpdateDescription(rawTitle):'';
    if (/^https?:/i.test(url)) clouds.push({ title: qmpCloud?require('./cloud-update-description').withoutUpdateDescription(rawTitle,description):rawTitle, url, type: data.website==='qmp4'||group==='七味'?require('./cloud-drive-types').cloudDriveType(url,group,rawTitle):group, quality: String(item.quality || item.zqxd || item.definition || ''), size: String(item.size || item.zsize || item.file_size || ''), date: String(item.date || item.ezt || item.update_time || description || ''), code: String(item.code || item.extraction_code || item.receive_code || '') });
  }
  return { movie, seeds, clouds, wp_num:data.wp_num };
}

async function fetchCloudDetail(id,fresh=false) {
  if(String(id).startsWith('qm5:'))return normalizeCloudDetail(await getQmp4Provider().detail(id,{fresh}));
  if(String(id).startsWith('jy4:'))return normalizeCloudDetail(await getJyingProvider().detail(id,{fresh}));
  if(String(id).startsWith('bt3:'))return normalizeCloudDetail(await getBtbtlaProvider().detail(id,{fresh}));
  if(String(id).startsWith('gy:'))return normalizeCloudDetail(await getGuanyingProvider().detail(id,{fresh}));
  const result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/getVideoDetail?${new URLSearchParams({ ...SITE_PARAMS, id: String(id || '') })}`,{fresh});
  if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '影片详情获取失败');
  return normalizeCloudDetail({ ...(result.data || {}), doub_id: result.data?.doub_id || result.data?.idcode || id });
}

function scanExportTools() { return require(path.join(__dirname, 'scan-export.js')); }
const SCAN_EXPORT_FILE = () => path.join(app.getPath('userData'), 'scan-export.json');
let scanExportCache;
function scanExportSnapshot() {
  if (!scanExportCache) {
    if (fs.existsSync(SCAN_EXPORT_FILE())) {
      try { scanExportCache = JSON.parse(fs.readFileSync(SCAN_EXPORT_FILE(), 'utf8')); }
      catch (_) { throw new Error('扫描导出记录损坏，原文件已保留'); }
    } else scanExportCache = { signature: '', rows: [], complete: false };
  }
  return scanExportCache;
}
function saveScanExport() {
  const file = SCAN_EXPORT_FILE(); fs.mkdirSync(path.dirname(file), { recursive: true });
  if (jsonStore) jsonStore.set(file, scanExportSnapshot());
  else { fs.writeFileSync(file + '.tmp', JSON.stringify(scanExportSnapshot()), 'utf8'); fs.renameSync(file + '.tmp', file); }
}
function beginScanExport(signature, restart) {
  if(readConfig().monitor?.scanOnly){const h=require('./magnet-scan-history');h.prepare(scanExportSnapshot(),h.scope(monitorConfig().filters),signature);saveScanExport();return;}
  if (restart || scanExportSnapshot().signature !== signature) { scanExportCache = require('./magnet-scan-history').reset(scanExportSnapshot(),signature);saveScanExport(); }
}
function recordScannedMagnets(movie, detail, filters,mode='movie') {
  filters=require('./monitor-size-ranges').sizeFilters(filters,mode);
  const tools = scanExportTools(); const normalized = normalizeCloudDetail(detail);
  const metadata = { ...normalized.movie, id: normalized.movie.id || movie.id, webUrl: normalized.movie.webUrl || originalMovieUrl('', movie.id) };
  const snapshot = scanExportSnapshot(); const rows = new Map(snapshot.rows.map(row => [magnetKey(row.url), row]));
  for (const seed of normalized.seeds) if (/^magnet:\?/i.test(seed.url) && matchesMonitorFilters(seed, detail, filters)) {
    const row = tools.exportRow(seed, {...metadata,title:metadata.title||movie.title}); const old = rows.get(magnetKey(seed.url));
    if (old) row.media = Object.fromEntries(tools.MEDIA_KEYS.map(key => [key, row.media[key] || old.media?.[key] || '']));
    rows.set(magnetKey(seed.url), row);
  }
  snapshot.rows = [...rows.values()];
}
function mergeExportRecord(primary = {}, fallback = {}) {
  const row = {...fallback,...primary};
  for (const key of ['movieTitle','chineseTitle','size','sizeGB','url','title','seedId','movieId','movieUrl','releaseDate','genre','country','publishDate']) row[key] = primary[key] || fallback[key] || '';
  row.media = Object.fromEntries(scanExportTools().MEDIA_KEYS.map(key=>[key,primary.media?.[key] || fallback.media?.[key] || '']));
  return row;
}
function cachedRecordForMagnet(url) {
  const key = magnetKey(url), uid = String(readConfig().monitorAccountUid || loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || '');
  return getDatabaseResource(resourceDatabase(), `${uid}|${key}`);
}
let metadataQueue = Promise.resolve();
const metadataInflight = new Map();
let metadataPermission = { signature:'',until:0,message:'' };
function metadataSessionSignature(movieId='') { return crypto.createHash('sha256').update(String(movieId).startsWith('gy:') ? readConfig().guanyingSession?.savedAt || '' : loadSiteSession().token || '').digest('hex'); }
async function hydrateHistoryResource(uid, key, force = false, movies = new Map()) {
  const identity = `${uid}|${key}`;
  if (metadataInflight.has(identity)) return metadataInflight.get(identity);
  const pending = (async()=>{
    let resource = getDatabaseResource(resourceDatabase(), identity); if (!resource) throw new Error('本地资源记录不存在');
    let row = mergeExportRecord(resource.exportRecord || {},{url:resource.url,title:resource.title,movieId:resource.movieId,size:resource.size,sizeGB:resource.sizeGB});
    try { const saved = scanExportSnapshot().rows.find(item=>magnetKey(item.url)===key); if(saved) row=mergeExportRecord(row,saved); } catch (_) {}
    const tools = scanExportTools(); let movieInfo=resource.movieInfo, seedInfo=resource.seedInfo, torrentInfo=resource.torrentInfo;
    if (movieInfo) {
      const movie=normalizeMovie(movieInfo);
      row=mergeExportRecord(row,tools.exportRow({url:row.url,title:row.title,date:seedInfo?.ezt || seedInfo?.eztime,raw:seedInfo || {}},{...movie,id:row.movieId || movie.id}));
    }
    if (torrentInfo) row.media = mergeExportRecord(row,{media:tools.parseMedia(torrentInfo)}).media;
    const signature = metadataSessionSignature(row.movieId);
    try {
      if ((!row.seedId || !row.releaseDate || !row.genre || !row.country || !row.movieTitle) && row.movieId && !resource.movieInfoFetched) {
        if (!movies.has(row.movieId)) movies.set(row.movieId,await fetchMovieDetail(row.movieId));
        const detail=movies.get(row.movieId), normalized=normalizeCloudDetail(detail);
        movieInfo={...detail}; for(const field of ['ecca','all_seeds','arrare','movies_online_seed'])delete movieInfo[field];
        row=mergeExportRecord(row,{releaseDate:normalized.movie.releaseDate,genre:normalized.movie.genre,country:normalized.movie.country,movieUrl:normalized.movie.webUrl});
        const seed=normalized.seeds.find(item=>magnetKey(item.url)===key);
        if(seed){seedInfo=seed.raw;row=mergeExportRecord(row,tools.exportRow(seed,{...normalized.movie,id:row.movieId}));}
        resource.movieInfoFetched=true;
      }
      if (tools.MEDIA_KEYS.some(field=>!row.media?.[field]) && !torrentInfo) {
        if(String(row.movieId).startsWith('qm5:')){torrentInfo=await getQmp4Provider().torrent(seedInfo || {});row=mergeExportRecord(row,{media:tools.parseMedia(torrentInfo)});}else if(String(row.movieId).startsWith('jy4:')){torrentInfo=await getJyingProvider().torrent(seedInfo || {});row=mergeExportRecord(row,{media:tools.parseMedia(torrentInfo)});}else if(String(row.movieId).startsWith('bt3:')){torrentInfo=await getBtbtlaProvider().torrent(seedInfo || {});if(torrentInfo.zlink&&magnetKey(torrentInfo.zlink)!==key)throw Error('BT影视种子详情与本地磁力不一致');row=mergeExportRecord(row,{media:tools.parseMedia(torrentInfo)});}else if(String(row.movieId).startsWith('gy:')) {
          torrentInfo=await getGuanyingProvider().torrent(seedInfo || {});
          if(torrentInfo.zlink && magnetKey(torrentInfo.zlink)!==key)throw new Error('种子详情磁力与本地记录不一致，未写入');
          row=mergeExportRecord(row,{media:tools.parseMedia(torrentInfo)});
        } else {
        if (!/^\d+$/.test(row.seedId || '')) throw new Error('没有对应的网站种子ID，暂时无法补取媒体信息；已有本地信息已保留');
        if (!force && metadataPermission.signature===signature && metadataPermission.until>Date.now()) throw new Error(metadataPermission.message);
        const result=await apiRequest(`${mirrorConfig().current}/prod/api/v1/getTrDetail?${new URLSearchParams({...SITE_PARAMS,id:row.seedId})}`);
        if(!result.success || Number(result.code)!==200){const reason=result.message || '种子详情获取失败';if(/VIP|开通|登录|login|授权/i.test(reason))metadataPermission={signature,until:Date.now()+300000,message:reason};throw new Error(reason);}
        torrentInfo=result.data || {};
        if(torrentInfo.zlink && magnetKey(torrentInfo.zlink)!==key){torrentInfo=undefined;throw new Error('种子详情磁力与本地记录不一致，未写入');}
        row=mergeExportRecord(row,{media:tools.parseMedia(torrentInfo)});
        }
      }
      resource.metadataError='';
    } catch(error){resource.metadataError=error.message;}
    // The database may have received a task state update while the website request was pending.
    resource = {...getDatabaseResource(resourceDatabase(), identity),exportRecord:row,movieInfo,seedInfo,torrentInfo,movieInfoFetched:resource.movieInfoFetched,metadataError:resource.metadataError,metadataAttemptAt:Date.now(),metadataSession:signature};
    const database=resourceDatabase();database.resources[identity]=resource;writeResourceDatabase(database);notifySubmitHistoryUpdated();
    return {row,reason:resource.metadataError || '',missing:tools.MEDIA_KEYS.some(field=>!row.media?.[field])};
  })().finally(()=>metadataInflight.delete(identity));
  metadataInflight.set(identity,pending);return pending;
}
function queueMetadataCapture(uid,key) {
  if(!uid)return;
  setTimeout(()=>{
    if (shuttingDown) return;
    metadataQueue=metadataQueue.then(async()=>{
      const resource=getDatabaseResource(resourceDatabase(), `${uid}|${key}`);if(!resource)return;
      if(resource.metadataAttemptAt>Date.now()-86400000 && resource.metadataSession===metadataSessionSignature(resource.movieId))return;
      const result=await hydrateHistoryResource(uid,key);
      if(result.reason)appendMonitorLog(`资源信息已保存，部分字段暂未补齐：${resource.title || resource.url}`,'warning',result.reason,String(resource.movieId).startsWith('gy:')?'guanying':'butailing');
    }).catch(error=>appendMonitorLog('本地资源信息补取失败','warning',error.message));
  },100);
}
function submissionDisplayFeedback(row) { return row.status === 'pending' ? `115已接受提交，目标：${row.folderName || '原指定目录'}；本地记录用于去重与大小比较` : publicSubmissionFeedback(row.message); }
function publicSubmissionFeedback(value) { return String(value || '').replace(/\s*[（(](?:CID|UID)\s*[^）)]*[）)]/gi,'').replace(/\b(?:CID|UID)\s*[:：]?\s*\d+\b/gi,'').replace(/实际保存目录等待核对|等待核对|目录等待核对/g,'后台更新保存状态'); }
let scanExportRunning = false;
let scanExportCancelled = false;
function exportFilenameStamp(date = new Date()) { const pad = value => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`; }
function exportProgress(message) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan-export-progress', message); }
async function exportScannedMagnets(enrich = true) {
  if (scanExportRunning) throw new Error('正在导出扫描结果，请等待完成');
  const snapshot = scanExportSnapshot();
  if (!snapshot.rows.length) throw new Error('暂无已保存扫描结果，请先执行资源扫描；旧版扫描需要用新版重新扫描一次');
  scanExportRunning = true; scanExportCancelled = false;
  try {
    const rows = JSON.parse(JSON.stringify(snapshot.rows)); const completeAtStart = Boolean(snapshot.complete);
    const choice = await dialog.showSaveDialog(mainWindow, { title: '导出扫描磁力为Excel', defaultPath: `扫描磁力-${exportFilenameStamp()}.xlsx`, filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
    if (choice.canceled || !choice.filePath) return { cancelled: true };
    let missing = 0; const tools = scanExportTools(); const movies = new Map(); const errors = new Set();
    let permissionFailure = '';
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]; Object.assign(row,mergeExportRecord(row,cachedRecordForMagnet(row.url)?.exportRecord)); exportProgress(`补充媒体摘要 ${index + 1}/${rows.length}：${row.title}`);
      if (enrich && !scanExportCancelled) {
        try {
          const local=cachedRecordForMagnet(row.url);
          if (local) {
            const hydrated=await hydrateHistoryResource(local.uid,magnetKey(row.url),false,movies);
            Object.assign(row,mergeExportRecord(row,hydrated.row));
            if(hydrated.reason)errors.add(hydrated.reason);
            if(tools.MEDIA_KEYS.some(key=>!row.media?.[key]))missing++;
            continue;
          }
          if ((!row.releaseDate || !row.seedId) && row.movieId) {
            if (!movies.has(row.movieId)) movies.set(row.movieId, await fetchMovieDetail(row.movieId));
            const detail = normalizeCloudDetail(movies.get(row.movieId));
            row.releaseDate ||= detail.movie.releaseDate;
            row.genre ||= detail.movie.genre; row.country ||= detail.movie.country;
            const seed = detail.seeds.find(seed => magnetKey(seed.url) === magnetKey(row.url));
            row.seedId ||= seed?.raw?.id ? String(seed.raw.id) : '';
          }
          if (tools.MEDIA_KEYS.some(key => !row.media?.[key])) {
            if (permissionFailure) throw new Error(permissionFailure);
            if (!/^\d+$/.test(row.seedId || '')) throw new Error('网站未返回当前磁力的种子详情ID，请登录不太灵后重试');
            const result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/getTrDetail?${new URLSearchParams({ ...SITE_PARAMS, id: row.seedId })}`);
            if (!result.success || Number(result.code) !== 200) {
              const reason = result.message || '种子详情接口返回失败';
              if (/VIP|开通|登录|login|授权/i.test(reason)) permissionFailure = reason;
              throw new Error(reason);
            }
            const data = result.data || {};
            if (data.zlink && magnetKey(data.zlink) !== magnetKey(row.url)) throw new Error('种子详情磁力与扫描记录不一致，未写入');
            const media = tools.parseMedia(data);
            if (!tools.MEDIA_KEYS.some(key => media[key])) throw new Error('种子详情未包含媒体信息，网站可能未提供摘要');
            row.media = Object.fromEntries(tools.MEDIA_KEYS.map(key => [key, media[key] || row.media?.[key] || '']));
          }
        } catch (error) { errors.add(error.message); appendMonitorLog(`导出媒体摘要获取失败：${row.title}`, 'warning', error.message); }
      }
      if (tools.MEDIA_KEYS.some(key => !row.media?.[key])) missing++;
    }
    const target = /\.xlsx$/i.test(choice.filePath) ? choice.filePath : choice.filePath + '.xlsx';
    if (jsonStore) await jsonStore.xlsx(target, rows); else fs.writeFileSync(target, tools.buildXlsx(rows));
    if (scanExportSnapshot().signature === snapshot.signature) {
      const saved = new Map(scanExportSnapshot().rows.map(row => [magnetKey(row.url), row]));
      for (const row of rows) if (saved.has(magnetKey(row.url))) Object.assign(saved.get(magnetKey(row.url)), row);
      saveScanExport();
    }
    const result = { path: target, count: rows.length, missing, partialScan: !completeAtStart, enrichmentStopped: scanExportCancelled, reasons: [...errors] };
    appendMonitorLog(`已导出${rows.length}条扫描磁力`, 'info', `${target} · ${missing}条媒体摘要字段未齐全，缺失字段留空`);
    return result;
  } finally { scanExportRunning = false; }
}

function monitorScanSignature(filters) {
  const { sort, ...selection } = filters;
  const uid = readConfig().monitor?.scanOnly?'local':(loadCookie().match(/(?:^|;\s*)UID=(\d+)/) || [])[1] || '';
  return crypto.createHash('sha256').update(JSON.stringify(['native-year-validation-v3-episode-minimum',selection, uid, readConfig().monitor?.scanOnly?'local-history':loadSiteSession().token, readConfig().monitor?.scanOnly?'local-history':mirrorConfig().current])).digest('hex');
}
function bindMonitorAccount(uid) {
  const config = readConfig(); const previous = String(config.monitorAccountUid || '');
  if (previous === String(uid)) return;
  config.monitorAccounts = config.monitorAccounts || {};
  if (previous) config.monitorAccounts[previous] = { seen: config.monitor?.seen || [], best: config.monitorMovieBest || {}, versions: config.monitorSavedVersions || {} };
  if (previous) {
    const saved = config.monitorAccounts[String(uid)] || {};
    config.monitor = { ...(config.monitor || {}), seen: saved.seen || [] };
    config.monitorMovieBest = saved.best || {}; config.monitorSavedVersions = saved.versions || {}; delete config.monitorScan;
  }
  config.monitorAccountUid = String(uid); writeConfig(config);
}
function monitorSeenKeys() {
  const config = readConfig(); const uid = String(config.monitorAccountUid || '');
  const keys = new Set(config.monitor?.seen || []);
  for (const resource of databaseResourceEntries(resourceDatabase()).map(([,row]) => row)) if (uid && resource.uid === uid) {
    if (ACCEPTED_RESOURCE_STATES.has(resource.status)) keys.add(resource.key);
    else if (resource.status === 'failed') {if(cloudNeedsFallback(uid,resource.url))keys.add(resource.key);else keys.delete(resource.key);}
  }
  return keys;
}
function selectMonitorCandidates(mode, movie, detail, filters) {
  filters=require('./monitor-size-ranges').sizeFilters(filters,mode);
  if(!require('./monitor-size-ranges').modeAllowed(filters,mode))return {candidates:[],unrecognized:0};
  const seen = monitorSeenKeys(); const bestSaved = readConfig().monitorMovieBest || {};
  const normalized = normalizeCloudDetail(detail);
  const info = {...normalized.movie,id:String(movie.id),webUrl:originalMovieUrl(normalized.movie.webUrl,movie.id)};
  const movieInfo = {...detail}; for (const key of ['ecca','all_seeds','arrare','movies_online_seed']) delete movieInfo[key];
  const scope=cloudFallbackScope(movie.id,String(readConfig().monitorAccountUid || ''));
  const matching = normalized.seeds.filter(seed => matchesMonitorFilters(seed, detail, fallbackSeedFilters(seed,detail,filters,movie.id,mode,scope))).map(seed=>({...seed,exportRecord:scanExportTools().exportRow(seed,info),movieInfo}));
  if (mode === 'tv') return selectTelevisionCoverage(movie, detail, matching, filters, seen, bestSaved);
  const groups = new Map(); let unrecognized = 0;
  for (const seed of matching) {
    const episode = mode === 'tv' ? episodeIdentity(seed.title) : '';
    if (mode === 'tv' && !episode) { unrecognized++; continue; }
    const selectionKey = mode === 'tv' ? `tv:${movie.id}:${episode}` : String(movie.id);
    if (!groups.has(selectionKey)) groups.set(selectionKey, []);
    groups.get(selectionKey).push(seed);
  }
  const candidates = [];
  const uid = String(readConfig().monitorAccountUid || ''); const database = resourceDatabase(); let databaseChanged = false;
  for (const [selectionKey, versions] of groups) {
    for (const version of versions) if (uid && seen.has(magnetKey(version.url))) {
      const stored = getDatabaseResource(database, `${uid}|${magnetKey(version.url)}`); const sizeGB = sizeInGb(version.size);
      if (!stored?.associations?.[selectionKey] || stored.associations[selectionKey].sizeGB !== sizeGB) {
        mergeDatabaseResource(database, { ...version, uid, selectionKey, movieId: movie.id, movieTitle: movie.title, mode, sizeGB }, stored?.status || 'legacy_accepted'); databaseChanged = true;
      }
    }

    const previousSize = Math.max(usableSavedBest(bestSaved[selectionKey],uid), resourceDatabaseBestSize(selectionKey, uid), ...versions.filter(item => seen.has(magnetKey(item.url)) && !cloudNeedsFallback(uid,item.url)).map(item => sizeInGb(item.size)));
    const selected = filters.compareSize !== false ? [chooseLargestSeed(versions.filter(version => sizeInGb(version.size) > 0 && !cloudNeedsFallback(uid,version.url)))] : versions;
    for (const seed of selected) {
      if (!seed) continue; const key = magnetKey(seed.url);
      if (seen.has(key) || (filters.compareSize !== false && previousSize > 0 && sizeInGb(seed.size) <= previousSize)) continue;
      candidates.push({ ...seed, mode, movieId: String(movie.id), selectionKey, candidateKey: filters.compareSize !== false ? selectionKey : `${selectionKey}|${key}`, movieTitle: movie.title, key, updatedAt: filters.compareSize !== false ? Math.max(...versions.map(item => resourceTime(item.date))) : resourceTime(seed.date) });
    }
  }
  if (databaseChanged) writeResourceDatabase(database);
  return { candidates, unrecognized };
}
function persistMonitorScan(checkpoint) {
  const config = readConfig(); config.monitorScan = { ...checkpoint, updatedAt: new Date().toISOString() }; writeConfig(config);
}
function clearMonitorScan(signature) {
  const config = readConfig(); if (config.monitorScan?.signature === signature) { delete config.monitorScan; writeConfig(config); }
}
function monitorCatalogQueries(filters) {
  let queries = [{ strictCatalog: true }];
  for (const key of ['genres', 'countries', 'years', 'qualities', 'tags']) {
    let values = [...new Set(filters[key] || [])].filter(Boolean);
    if (key === 'years') values = [...new Set(values.flatMap(value => {
      if (value === '近三年') return Array.from({ length: 3 }, (_, i) => String(new Date().getFullYear() - i));
      const decade = { '20年代': 2020, '10年代': 2010, '00年代': 2000, '90年代': 1990, '80年代': 1980 }[value];
      if (decade) return Array.from({ length: 10 }, (_, i) => String(decade + i));
      return [String(value)];
    }))];
    if (values.length) queries = queries.flatMap(query => values.map(value => ({ ...query, [key]: value })));
    if (queries.length > 512) throw new Error('筛选组合超过512组，请减少同时选择的类型、地区或年份；不会退回全库扫描');
  }
  return queries;
}

function matchesCatalogBeforeDetail(movie, filters) {
  if (movie.year && !yearMatches(yearValue({ year: movie.year }), filters.years)) return false;
  if (movie.genre && !containsAny(movie.genre, filters.genres)) return false;
  if (movie.country && !containsAny(movie.country, filters.countries)) return false;
  const range = parseScoreRange(filters.scoreRange);
  if (range && movie.score !== '' && movie.score != null && (Number(movie.score) < range[0] || Number(movie.score) > range[1])) return false;
  if (movie.magnetCountKnown && movie.magnetCount === 0) return false;
  if (filters.onlyCloud && movie.cloudCountKnown && movie.cloudCount === 0) return false;
  if (filters.onlyImdb && movie.imdbKnown && !movie.imdb) return false;
  return true;
}
async function scanMonitorCatalog(config, assertActive = () => {}, onCandidates = null) {
  const filters = config.filters; const signature = monitorScanSignature(filters); const queries = monitorCatalogQueries(filters);
  let checkpoint = readConfig().monitorScan;
  const newExportScan = !checkpoint || checkpoint.version !== 4 || checkpoint.signature !== signature;
  beginScanExport(signature, newExportScan);
  const history=config.scanOnly?require('./magnet-scan-history'):null;if(history)appendMonitorLog('在历史基础上增量采集','info',`已保留 ${scanExportSnapshot().rows.length} 条磁力；不清空本地历史。`);
  if (!checkpoint || checkpoint.version !== 4 || checkpoint.signature !== signature) {
    checkpoint = { version: 4, signature, startedAt: new Date().toISOString(), modeIndex: 0, page: 1, pages: 1, items: null, offset: 0, scanned: 0, keys: [], candidates: [], retryItems: [], phase: 'scan' };
  } else appendMonitorLog('继续上次未完成的资源扫描', 'info', `已检查 ${checkpoint.scanned} 部影片，已保留 ${checkpoint.candidates.length} 条候选；候选数量不是提交失败数量。`);
  const keys = new Set(checkpoint.keys); const candidates = new Map(checkpoint.candidates.map(item => [item.candidateKey || item.selectionKey, item]));
  const retries = new Map(checkpoint.retryItems.map(item => [`${item.mode}:${item.movie.id}`, item]));
  const flush = () => { checkpoint.keys = [...keys]; checkpoint.candidates = [...candidates.values()]; checkpoint.retryItems = [...retries.values()]; persistMonitorScan(checkpoint); saveScanExport(); };
  let stopRequested = false;
  const lowerBound = Math.max(require('./monitor-time').scanLowerBound(filters,Date.parse(checkpoint.startedAt)),history&&scanExportSnapshot().lastCompleteAt?Date.parse(scanExportSnapshot().lastCompleteAt)-86400000:0);
  const collect = async (mode, movie, allowCutoff = false) => {
    assertActive();
    const kind=mode==='movie'?'电影':'电视剧';
    appendMonitorLog(`正在检查${kind}：${movie.title || movie.id}`,'info',`年份：${movie.year || '未提供'}；影片编号：${movie.id}。`);
    if (!matchesCatalogBeforeDetail(movie, filters)) {appendMonitorLog(`${kind}筛选不符：${movie.title || movie.id}`,'info','网站列表字段与当前年份、类型、评分或资源条件不符，未请求详情。');return;}
    if(history&&allowCutoff&&lowerBound&&resourceTime(movie.seedUpdatedAt)&&resourceTime(movie.seedUpdatedAt)<lowerBound){appendMonitorLog('增量采集已到历史时间边界','info','保留已有磁力，只继续检查最新变化范围。');return true;}
    if(history&&history.skip(scanExportSnapshot(),movie)){appendMonitorLog(`历史磁力已采集：${movie.title || movie.id}`,'info','列表未变化，跳过重复详情请求。');return;}
    const detail = await fetchMovieDetail(movie.id); assertActive();
    const updated = resourceTime(detail?.seed_updated_at);
    const quota = Math.max(1, Number(filters.maxItems) || 30);
    const latest = [...candidates.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    const quotaBound = config.autoSubmit && !onCandidates && latest.length >= quota ? latest[quota - 1].updatedAt : 0;
    const boundary = Math.max(lowerBound, quotaBound);
    // sg=1 is the website's seed-update order. A movie's latest seed bounds every version.
    // Unknown timestamps never trigger early termination; retry items are checked independently.
    if (allowCutoff && updated && boundary && updated < boundary) {
      appendMonitorLog(`已到达${mode === 'movie' ? '电影' : '电视剧'}更新时间扫描边界`, 'info',
        `${movie.title} 最新磁力更新 ${detail.seed_updated_at}，早于 ${new Date(boundary).toLocaleString('zh-CN')}；停止此组后续页，${quotaBound > lowerBound ? '已找到足够的较新候选' : '超出指定日期范围'}。`);
      return true;
    }
    recordScannedMagnets(movie, detail, filters,mode);if(history)history.mark(scanExportSnapshot(),movie);
    if(config.scanOnly){appendMonitorLog(`仅本地采集：${movie.title || movie.id}`,'info',`累计 ${scanExportSnapshot().rows.length} 条磁力；不调用网盘接口，不按已提交或最大版本排除。`);return;}
    if(mode==='tv'){await inspectTelevisionFiles(movie,detail,filters,assertActive);assertActive();}
    const result = selectMonitorCandidates(mode, movie, detail, filters);
    const all=normalizeCloudDetail(detail).seeds,matched=all.filter(seed=>matchesMonitorFilters(seed,detail,require('./monitor-size-ranges').sizeFilters(filters,mode))), seen=monitorSeenKeys();
    appendMonitorLog(`${kind}检查完成：${movie.title || movie.id}`,'info',`种子 ${all.length} 条；符合筛选 ${matched.length} 条；已处理磁力 ${matched.filter(seed=>seen.has(magnetKey(seed.url))).length} 条；本次候选 ${result.candidates.length} 条。${!result.candidates.length?'无新候选：资源筛选不符、已提交、未超过已保存大小或集数待确认。':''}`);
    for (const item of result.candidates) candidates.set(item.candidateKey || item.selectionKey, item);
    if (onCandidates && result.candidates.length) {
      flush(); // Save the scan before network submission; accepted magnets have durable deduplication.
      try { stopRequested = Boolean(await onCandidates(result.candidates, false)); assertActive(); }
      catch (error) { throw Object.assign(error, { streamingFatal: true }); }
    }
    if (result.unrecognized) appendMonitorLog(`剧集 ${movie.title} 有 ${result.unrecognized} 条资源集数/逐集大小不明、单集未超过最小值或与明确分集重复，暂不自动提交`, 'warning', '已识别的集数范围按覆盖记录去重；集数未知的合集仅在没有同季明确分集资源时选择最大一份。');
    for (const item of result.candidates) if (item.episodeKeys?.length > 1 || item.coverageUnknown) appendMonitorLog(`合集选择：${item.title}`, 'info', item.coverageUnknown ? '集数未明：同季只选最大一份合集，待检查记录仍保留，不猜测已覆盖集数。' : `${item.coverageReason || '选择最大版本'} · ${item.episodeKeys.map(ep=>`${ep} ${candidateEpisodeSize(item,ep).toFixed(3)} GB`).join(', ')} · 来源：${item.sizeSource}${item.sizeSource==='平均估算'?'（文件清单暂未获得）':''}；一条磁力覆盖多集。`);
  };
  appendMonitorLog(`按筛选请求 ${queries.length} 组条件`, 'info', JSON.stringify(queries) + ` · 更新时间范围：${filters.dateMode === 'range' ? (filters.startDate || '不限') + ' 至 ' + (filters.endDate || '不限') : filters.dateMode==='minutes'?'最近 '+filters.withinMinutes+' 分钟':'最近 ' + (filters.withinDays || '不限') + ' 天'} · 每轮提交上限 ${filters.maxItems} 条`);
  try {
    if (onCandidates && candidates.size) { stopRequested = Boolean(await onCandidates([...candidates.values()], true)); assertActive(); }
    if (checkpoint.phase === 'scan' && !stopRequested) scanGroups: for (; checkpoint.modeIndex < queries.length * 2; checkpoint.modeIndex++) {
      const mode = ['movie', 'tv'][checkpoint.modeIndex % 2];if(!require('./monitor-size-ranges').modeAllowed(filters,mode)){checkpoint.page=1;checkpoint.pages=1;checkpoint.items=null;checkpoint.offset=0;continue;} const query = queries[Math.floor(checkpoint.modeIndex / 2)];
      while (checkpoint.page <= checkpoint.pages) {
        assertActive();
        if (!checkpoint.items) {
          const batch = await fetchCloudCatalog(mode, checkpoint.page, query); assertActive();
          const knownYears = batch.items.map(movie => yearValue({ year: movie.year })).filter(Boolean);
          if (/^\d{4}$/.test(query.years || '') && knownYears.some(year => year !== Number(query.years)) && !nativeYearBatchCompatible(batch,query.years)) {
            throw Object.assign(new Error(`网站接口未按年份 ${query.years} 返回资源，已停止扫描，避免退回全库；请检查镜像或登录状态，恢复后点击立即检查`), { noMirrorRetry: true, filterRejected: true });
          }
          checkpoint.pages = Math.max(1, Math.ceil(batch.total / batch.limit)); checkpoint.items = batch.items; checkpoint.offset = 0;
        }
        const label = `扫描${mode === 'movie' ? '电影' : '电视剧'}筛选结果：条件组 ${Math.floor(checkpoint.modeIndex / 2) + 1}/${queries.length}，第 ${checkpoint.page} 页（网站分页上限 ${checkpoint.pages}，达到更新时间或数量边界停止）`;
        appendMonitorLog(label, 'info', `已检查 ${checkpoint.scanned} 部影片，发现 ${candidates.size} 条候选磁力；${onCandidates ? '符合条件的资源正在边扫描边提交，每部影片先比较全部版本。' : '扫描完成后按最新更新时间提交。'}`);
        pushMonitorStatus({ ...monitorConfig(), lastMessage: `${label}；候选 ${candidates.size} 条（${onCandidates ? '边扫描边离线' : '尚未进入提交阶段'}）`, running: true });
        for (; checkpoint.offset < checkpoint.items.length; checkpoint.offset++) {
          const movie = checkpoint.items[checkpoint.offset]; const movieKey = `${mode}:${movie.id}`;
          if (keys.has(movieKey)) {appendMonitorLog(`本轮已经检查：${mode==='movie'?'电影':'电视剧'} ${movie.title || movie.id}`,'info','另一筛选条件组或断点已检查，无需重复请求。');continue;}
          try { if (await collect(mode, movie, true)) { checkpoint.page = checkpoint.pages; checkpoint.offset = checkpoint.items.length; break; } }
          catch (error) {
            if (error.mirrorsExhausted || error.noMirrorRetry || error.monitorCancelled || error.streamingFatal) throw error;
            retries.set(movieKey, { mode, movie });
            appendMonitorLog(`影片 ${movie.title} 详情获取失败，稍后补查`, 'warning', error.message);
          }
          keys.add(movieKey); checkpoint.scanned++;
          if (stopRequested) { checkpoint.offset++; flush(); break scanGroups; }
        }
        checkpoint.page++; checkpoint.items = null; checkpoint.offset = 0; flush();
      }
      checkpoint.page = 1; checkpoint.pages = 1; checkpoint.items = null; checkpoint.offset = 0;
    }
    if (checkpoint.phase !== 'complete') {
      checkpoint.phase = 'retry'; flush();
      for (const [key, item] of retries) {
        if (stopRequested) break;
        try { await collect(item.mode, item.movie); retries.delete(key); }
        catch (error) { if (error.mirrorsExhausted || error.noMirrorRetry || error.monitorCancelled || error.streamingFatal) throw error; appendMonitorLog(`影片 ${item.movie.title} 补查失败，下轮重新检查`, 'warning', error.message); }
      }
      checkpoint.phase = 'complete'; scanExportSnapshot().complete = retries.size === 0 && !stopRequested;if(history&&scanExportSnapshot().complete)history.complete(scanExportSnapshot(),checkpoint.startedAt); flush();
    }
  } catch (error) { flush(); throw error; }
  const result = [...candidates.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  result.scanFailures = retries.size; result.signature = signature; result.scanned = checkpoint.scanned; result.quotaReached = stopRequested; return result;
}

function resourceTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10000000000 ? numeric * 1000 : numeric;
  return Date.parse(String(value || '')) || 0;
}

function hasUpdateTimeFilter(filters) {
  return filters.dateMode==='minutes'?true:filters.dateMode === 'range' ? Boolean(filters.startDate || filters.endDate) : Number(filters.withinDays) > 0;
}
function validateUpdateTimeFilter(filters) {
  if(filters.dateMode==='minutes'){require('./monitor-time').minutes(filters.withinMinutes);return;}
  if (filters.dateMode !== 'range') return;
  for (const value of [filters.startDate, filters.endDate]) if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('请选择有效日期');
  if (filters.startDate && filters.endDate && filters.startDate > filters.endDate) throw new Error('开始日期不能晚于结束日期');
}
function matchesUpdateTime(value, filters, now = Date.now()) {
  if (!hasUpdateTimeFilter(filters)) return true;
  validateUpdateTimeFilter(filters);
  if(filters.dateMode==='minutes')return require('./monitor-time').minuteMatch(value,filters,now);
  const time = resourceTime(value);
  if (!time) return false;
  if (filters.dateMode === 'range') {
    const start = filters.startDate ? new Date(filters.startDate + 'T00:00:00').getTime() : -Infinity;
    const end = filters.endDate ? new Date(filters.endDate + 'T00:00:00').getTime() : Infinity;
    const nextDay = new Date(end); if (Number.isFinite(end)) nextDay.setDate(nextDay.getDate() + 1);
    return time >= start && time < (Number.isFinite(end) ? nextDay.getTime() : Infinity);
  }
  return time >= now - Number(filters.withinDays) * 86400000 && time <= now;
}
function chooseLargestSeed(seeds) {
  return seeds.slice().sort((a, b) => sizeInGb(b.size) - sizeInGb(a.size) || resourceTime(b.date) - resourceTime(a.date))[0];
}

// Read the site's file tree rather than dividing a torrent's total size by its episode count.
function episodeFileInformation(raw, title, detail = {}) {
  const records=[], visited=new Set(), sizes={}, files=[], unresolved=[];
  const titleCoverage=episodeCoverage(title,detail), season=titleCoverage?.season || 1;
  const visit=(value,depth=0)=>{
    if(value==null || depth>12)return;
    if(Array.isArray(value)){for(const child of value)visit(child,depth+1);return;}
    if(typeof value==='string'){if(/^[\s]*[\[{]/.test(value)){try{visit(JSON.parse(value),depth+1);return;}catch(_){}}for(const line of value.replace(/<br\s*\/?\s*>|<\/(?:div|li|p)>/gi,'\n').split(/\r?\n/))if(line.trim())records.push({efname:line});return;}
    if(typeof value!=='object')return;
    if(value.efname || value.filename || value.name || value.path)records.push(value);
    for(const key of ['children','files','items'])if(value[key])visit(value[key],depth+1);
  };
  visit(raw?.zfiles || raw?.files || []);
  for(const file of records){
    const name=scanExportTools().text(file.efname || file.filename || file.name || file.path).replace(/<[^>]*>/g,'').trim();
    if(!/\.(?:mkv|mp4|avi|ts|m2ts|mov|wmv|webm)(?:\s|\(|$)/i.test(name) || visited.has(name))continue;
    if(/(?:^|[\\/])\.[a-z0-9]+(?:\s*[（(]|$)/i.test(name))continue;
    if(/(?:^|[\\/ ._-])(?:sample|trailer|preview)(?:[\\/ ._-]|$)/i.test(name))continue;
    visited.add(name);
    let size=sizeInGb(name.match(/[（(]\s*([\d.,]+\s*(?:[KMGT]i?B|bytes?))\s*[）)]\s*$/i)?.[1]?.replace(/,/g,'') || '');
    if(!size){for(const key of ['sizeGB','size_gb'])if(Number(file[key])>0)size=Number(file[key]);}
    if(!size){for(const key of ['size','file_size','length','sizeBytes','bytes']){const value=file[key];if(typeof value==='number' && value>0){size=value/1073741824;break;}if(typeof value==='string' && /[KMGT]i?B|bytes?/i.test(value)){size=sizeInGb(value);break;}}}
    // A tiny named site advert is not an episode. Unknown ordinary files remain reviewable.
    if (size > 0 && size < 0.01 && /我的电影网站|网站发布|网址导航|电影网站推荐|更多无水印高品质资源请访问/i.test(name)) continue;
    const coverage=episodeCoverage(name);
    let episode=coverage?.keys?.length===1 ? coverage.keys[0] : '';
    // Names with E19/第19集 inherit the pack's season; explicit Sxx/第x季 names do not.
    if(episode && !/\bS\d+|\b\d{1,2}x\d+|第\s*\d+\s*季/i.test(normalizedEpisodeText(name)))episode=episode.replace(/^S\d+/,`S${season}`);
    if(!episode){const bare=name.match(/(?:^|[\\/])(?:EP?[ ._-]*)?(\d{1,3})(?=[ ._-])/i);if(bare && titleCoverage?.keys?.includes(`S${season}E${Number(bare[1])}`))episode=`S${season}E${Number(bare[1])}`;}
    if(episode && size>0){sizes[episode]=(sizes[episode] || 0)+size;files.push({name,episode,sizeGB:size});}
    else unresolved.push({name,sizeGB:size,reason:!episode?'无法识别集号':'文件大小未提供'});
  }
  const keys=Object.keys(sizes).sort((a,b)=>Number(a.match(/^S(\d+)/)[1])-Number(b.match(/^S(\d+)/)[1]) || Number(a.match(/E(\d+)$/)[1])-Number(b.match(/E(\d+)$/)[1]));
  return {keys,sizes,files,unresolved,hasFileList:records.length>0,expectedKeys:titleCoverage?.keys || [],missingKeys:(titleCoverage?.keys || []).filter(key=>!keys.includes(key))};
}

async function inspectTelevisionFiles(movie, detail, filters, assertActive=()=>{}) {
  filters=require('./monitor-size-ranges').sizeFilters(filters,'tv');
  const siteLog=(message,level,details)=>appendMonitorLog(message,level,details,detail.website || 'butailing');
  const uid=String(readConfig().monitorAccountUid || loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || '');
  const signature=metadataSessionSignature(movie.id), normalized=normalizeCloudDetail(detail);
  const info={...normalized.movie,id:String(movie.id)};
  const movieInfo={...detail};for(const field of ['ecca','all_seeds','arrare','movies_online_seed'])delete movieInfo[field];
  const reviews=[], inspectedKeys=new Set(), seen=monitorSeenKeys(), scope=cloudFallbackScope(movie.id,uid);
  for(const seed of normalized.seeds){
    assertActive();
    const key=magnetKey(seed.url),identity=`${uid}|${key}`;let stored=getDatabaseResource(resourceDatabase(), identity), torrent=stored?.torrentInfo, reason='';
    if(inspectedKeys.has(key))continue;
    inspectedKeys.add(key);
    if(ACCEPTED_RESOURCE_STATES.has(stored?.status) || seen.has(key)){if(stored?.episodeFiles)seed.raw._episodeFiles=stored.episodeFiles;continue;}
    if(!matchesMonitorFilters(seed,detail,fallbackSeedFilters(seed,detail,filters,movie.id,'tv',scope)))continue;
    const preliminary=episodeCoverage(seed.title,detail);
    // A single named episode already has a site-reported size. Packs and unknown names need the file tree.
    const needsFiles=!preliminary || preliminary.opaque || preliminary.keys.length>1;
    if(!torrent && seed.raw?.zfiles) torrent=seed.raw;
    if(needsFiles && !torrent?.zfiles?.length && !torrent?.files?.length){
      if(stored?.fileInspectionSession===signature && stored.fileInspectionAt>Date.now()-86400000)reason=stored.fileInspectionError || '网站暂未提供文件清单';
      else try {
        if(detail.website==='qmp4'){torrent=await getQmp4Provider().torrent(seed.raw);assertActive();}else if(detail.website==='jying'){torrent=await getJyingProvider().torrent(seed.raw);assertActive();}else if(detail.website==='btbtla'){torrent=await getBtbtlaProvider().torrent(seed.raw,{signal:assertActive.signal});assertActive();}else if(detail.website==='guanying') {
          siteLog(`读取种子文件清单：${movie.title} · ${seed.title}`,'info','先读本地缓存，缺失时读取观影种子详情。','guanying');
          torrent=await getGuanyingProvider().torrent(seed.raw,{priority:0});assertActive();
        } else {
        if(!/^\d+$/.test(String(seed.raw?.id || '')))throw new Error('网站未提供种子详情ID');
        if(metadataPermission.signature===signature && metadataPermission.until>Date.now())throw new Error(metadataPermission.message);
        siteLog(`读取种子文件清单：${movie.title} · ${seed.title}`,'info','先读取本地缓存；缺失时请求不太灵种子详情。');
        const response=await apiRequest(`${mirrorConfig().current}/prod/api/v1/getTrDetail?${new URLSearchParams({...SITE_PARAMS,id:String(seed.raw.id)})}`);assertActive();
        if(!response.success || Number(response.code)!==200){const message=response.message || '种子详情获取失败';if(/VIP|开通|登录|login|授权/i.test(message))metadataPermission={signature,until:Date.now()+300000,message};throw new Error(message);}
        torrent=response.data || {};
        }
        if(torrent.zlink && magnetKey(torrent.zlink)!==key){torrent=undefined;throw new Error('种子详情磁力不一致，未用于比较');}
      }catch(error){if(error.monitorCancelled || error.mirrorsExhausted)throw error;reason=error.message;}
    }
    const fileInfo=episodeFileInformation(torrent || {},seed.title,detail);
    seed.raw._episodeFiles=fileInfo;
    if(needsFiles || torrent){
      const database=resourceDatabase();mergeDatabaseResource(database,{uid,url:seed.url,title:seed.title,size:seed.size,movieId:movie.id,mode:'tv',movieInfo,seedInfo:seed.raw,torrentInfo:torrent,exportRecord:scanExportTools().exportRow({...seed,media:torrent},info)},stored?.status || 'inspected');
      stored=getDatabaseResource(database, identity);if(stored){Object.assign(stored,{fileInspectionAt:Date.now(),fileInspectionSession:signature,fileInspectionError:reason,episodeFiles:fileInfo,movieInfoFetched:true});if(torrent)stored.exportRecord=mergeExportRecord(stored.exportRecord,{media:scanExportTools().parseMedia(torrent)});}
      writeResourceDatabase(database);
    }
    if(fileInfo.keys.length)siteLog(`种子逐集大小：${seed.title}`,'info',fileInfo.files.map(file=>`${file.episode} · ${file.sizeGB.toFixed(3)} GB · ${file.name}`).join('\n'));
    if(needsFiles && (!fileInfo.keys.length || fileInfo.missingKeys.length || fileInfo.unresolved.length)){
      const explanation=reason || (fileInfo.missingKeys.length ? `标题集数未在文件清单确认：${fileInfo.missingKeys.join('、')}` : fileInfo.unresolved.length ? '部分视频文件无法识别集号或大小' : '种子详情没有可识别的逐集文件信息');
      reviews.push({uid,movieId:String(movie.id),movieTitle:movie.title,title:seed.title,url:seed.url,originalUrl:detail.website==='guanying' ? GUANYING_ORIGIN+(seed.raw?.detailPath || require('./guanying-provider').pathFromId(movie.id)) : `${mirrorConfig().current}/${seed.raw?.id?'tr/'+seed.raw.id:'mv/'+movie.id}.html`,seedId:String(seed.raw?.id || ''),reason:explanation,missingKeys:fileInfo.missingKeys,files:fileInfo.unresolved});
      siteLog(`剧集文件检查需补充：${seed.title}`,'warning',`${explanation}；已保留待检查记录，未把未知文件假定为已覆盖剧集。`);
    }
  }
  const config=readConfig();const other=(config.monitorCoverageReview || []).filter(row=>row.uid!==uid || row.movieId!==String(movie.id));
  config.monitorCoverageReview=[...other,...reviews];writeConfig(config);
}

function normalizedEpisodeText(title) {
  return String(title || '').normalize('NFKC').replace(/[–—－]/g,'-').replace(/第\s*([零〇一二两三四五六七八九十百]+)\s*([集季])/g,(_,digits,unit)=>{
    const map={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};let total=0,number=0;
    for(const char of digits){if(char==='十'||char==='百'){total+=(number||1)*(char==='十'?10:100);number=0;}else number=map[char];}
    return `第${total+number}${unit}`;
  }).replace(/\bSeason[ ._-]*(\d{1,2})/ig,'S$1').replace(/\bEpisode[ ._-]*(\d{1,3})/ig,'E$1');
}
function episodeCoverage(title, detail = {}) {
  const value = normalizedEpisodeText(title);
  if (/\bS\d+\s*[-~至]\s*S\d+/i.test(value)) return null;
  const season = Number(value.match(/\bS(\d{1,2})(?!\d)/i)?.[1] || value.match(/第\s*(\d{1,2})\s*季/)?.[1] || 1);
  const build = episodes => {
    if (!episodes.length || episodes.length > 1000 || episodes.some(n => !Number.isInteger(n) || n < 1 || n > 999)) return null;
    const numbers = [...new Set(episodes)].sort((a,b) => a-b);
    return { season, keys: numbers.map(n => `S${season}E${n}`), opaque: false };
  };
  let match = value.match(/第?\s*(\d{1,3})\s*[-~至]\s*(\d{1,3})\s*集/);
  if (!match) {
    const english = value.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})\s*[-~至]\s*(?:S(\d{1,2})[ ._-]*)?E?(\d{1,3})(?!\d)/i);
    if (english) { if (english[3] && Number(english[3]) !== season) return null; match = ['', english[2], english[4]]; }
    else match = value.match(/\bEP?(\d{1,3})\s*[-~至]\s*(?:EP?)?(\d{1,3})(?!\d)/i);
  }
  if (match) {
    const start = Number(match[1]), end = Number(match[2]);
    return end >= start && end-start < 1000 ? build(Array.from({length:end-start+1},(_,i)=>start+i)) : null;
  }
  const list = value.match(/第\s*(\d{1,3}(?:\s*[、,]\s*\d{1,3})+)\s*集/);
  if (list) return build(list[1].split(/[、,]/).map(Number));
  const consecutive = value.match(/\bS\d{1,2}((?:E\d{1,3}){2,})(?!\d)/i);
  if (consecutive) return build([...consecutive[1].matchAll(/E(\d+)/ig)].map(m=>Number(m[1])));
  const count = value.match(/(?:全\s*|更新至\s*)(\d{1,3})\s*集/);
  if (count) return build(Array.from({length:Number(count[1])},(_,i)=>i+1));
  const single = episodeIdentity(value);
  if (single && Number(single.match(/E(\d+)$/)?.[1])>0) return { season, keys: [single], opaque: false };
  if (/全集|全季|合集|\bcomplete\b|\bfull[ ._-]*season\b/i.test(value)) {
    const total = String(detail.episodes || '').match(/^\s*(\d{1,3})\s*(?:集)?\s*$/);
    if (total) return build(Array.from({length:Number(total[1])},(_,i)=>i+1));
    // Unknown episode counts are a separate pack identity, never guessed as single episodes.
    return { season, keys: [], opaque: true };
  }
  return null;
}
function coverageCandidate(seed, movie, coverage) {
  const episodeKeys = coverage.keys;
  const identity = coverage.opaque ? `pack:S${coverage.season}:unknown` : episodeKeys.length === 1 ? episodeKeys[0] : `pack:${episodeKeys.join('+')}`;
  const selectionKey = `tv:${movie.id}:${identity}`;
  return { ...seed, mode:'tv', movieId:String(movie.id), movieTitle:movie.title, selectionKey, candidateKey:`${selectionKey}|${magnetKey(seed.url)}`,
    key:magnetKey(seed.url), updatedAt:resourceTime(seed.date), episodeKeys, episodeSizeGB:episodeKeys.length ? sizeInGb(seed.size)/episodeKeys.length : 0,
    episodeSizes:{...(seed.raw?._episodeFiles?.sizes || seed.episodeSizes || {})}, sizeSource:seed.raw?._episodeFiles?.keys?.length ? '种子文件清单' : episodeKeys.length===1 ? '资源大小' : '平均估算',
    coverageUnknown:coverage.opaque, season:coverage.season };
}
function seedEpisodeCoverage(seed,detail) {
  const files=seed.raw?._episodeFiles || seed.episodeFiles;
  if(files?.keys?.length)return {season:Number(files.keys[0].match(/^S(\d+)/)[1]),keys:files.keys,opaque:false};
  if(files?.hasFileList && files.unresolved?.length)return null;
  return episodeCoverage(seed.title,detail);
}
function candidateEpisodeSize(seed,episode) {return Number(seed.episodeSizes?.[episode]) || seed.episodeSizeGB;}
function selectTelevisionCoverage(movie, detail, matching, filters, seen, bestSaved) {
  const uid = String(readConfig().monitorAccountUid || ''), database = resourceDatabase();
  const groups = new Map(); let unrecognized = 0, changed = false;
  for (const stored of databaseResourceEntries(database).map(([,row]) => row)) if (stored.uid === uid && stored.movieId === String(movie.id) && ACCEPTED_RESOURCE_STATES.has(stored.status)) {
    const coverage = seedEpisodeCoverage(stored, detail);
    if (coverage?.keys.length && coverage.keys.some(key=>!stored.associations?.[`tv:${movie.id}:${key}`] || (stored.episodeFiles?.sizes?.[key] && stored.associations[`tv:${movie.id}:${key}`].sizeGB!==stored.episodeFiles.sizes[key]))) {
      const row = coverageCandidate({...stored,date:stored.updatedAt,raw:{_episodeFiles:stored.episodeFiles}},movie,coverage);
      mergeDatabaseResource(database,{...row,uid},stored.status); changed = true;
    }
  }
  // Backfill coverage for older accepted magnets, even if their publication date is outside today's filter.
  for (const seed of normalizeCloudDetail(detail).seeds) if (uid && seen.has(magnetKey(seed.url))) {
    const coverage = seedEpisodeCoverage(seed, detail); if (!coverage) continue;
    const row = coverageCandidate(seed, movie, coverage), stored = getDatabaseResource(database, `${uid}|${row.key}`);
    if (coverage.keys.length && coverage.keys.some(key => !stored?.associations?.[`tv:${movie.id}:${key}`] || (row.episodeSizes[key] && stored.associations[`tv:${movie.id}:${key}`].sizeGB!==row.episodeSizes[key]))) {
      mergeDatabaseResource(database,{...row,uid},stored?.status || 'legacy_accepted'); changed = true;
    }
  }
  if (changed) writeResourceDatabase(database);
  const recognizedSeasons = new Set();
  for (const seed of matching) {
    if(seen.has(magnetKey(seed.url)))continue;
    const coverage = seedEpisodeCoverage(seed, detail); if (!coverage) { unrecognized++; continue; }
    if(!require('./monitor-size-ranges').episodeMinimumAllowed(seed,coverage,Number(filters.minSizeGB)||0,sizeInGb)){unrecognized++;continue;}
    if (!coverage.opaque) recognizedSeasons.add(coverage.season);
    const row = coverageCandidate(seed, movie, coverage);
    if (!groups.has(row.selectionKey)) groups.set(row.selectionKey, new Map());
    groups.get(row.selectionKey).set(row.key,row);
  }
  const known = new Set();
  for (const resource of databaseResourceEntries(database).map(([,row]) => row)) if (resource.uid === uid && ACCEPTED_RESOURCE_STATES.has(resource.status) && !cloudNeedsFallback(uid,resource.url)) {
    for (const key of Object.keys(resource.associations || {})) if (key.startsWith(`tv:${movie.id}:S`)) known.add(key);
  }
  const baseline = key => Math.max(resourceDatabaseBestSize(key,uid), usableSavedBest(bestSaved[key],uid));
  const candidates = [], opaque = [];
  for (const [selectionKey, map] of groups) {
    const versions = [...map.values()];
    const measured=versions.some(seed=>Object.keys(seed.episodeSizes).length);
    const selected = filters.compareSize !== false && !measured ? [chooseLargestSeed(versions.filter(v=>sizeInGb(v.size)>0))] : versions;
    for (const seed of selected) {
      if (!seed || seen.has(seed.key)) continue;
      if (seed.coverageUnknown) {
        // Only use an opaque pack when this season has no identifiable episode resources.
        if (recognizedSeasons.has(seed.season)) { unrecognized++; continue; }
        const previous = Math.max(baseline(selectionKey), ...versions.filter(v=>seen.has(v.key)).map(v=>sizeInGb(v.size)));
        if (!previous || sizeInGb(seed.size)>previous) opaque.push(seed);
        continue;
      }
      candidates.push(seed);
    }
  }
  if (filters.compareSize === false) return { candidates:[...candidates.map(seed=>({...seed,candidateKey:`${seed.selectionKey}|${seed.key}`})),...opaque], unrecognized };
  const bestAvailable = new Map();
  for (const seed of candidates) for (const episode of seed.episodeKeys) {
    const key = `tv:${movie.id}:${episode}`;
    bestAvailable.set(key,Math.max(bestAvailable.get(key)||0,candidateEpisodeSize(seed,episode)));
    if (baseline(key)>0) known.add(key);
  }
  const planned = new Set(), selected = [];
  while (true) {
    const choices = candidates.map(seed=>{
      const useful = seed.episodeKeys.filter(ep=>{const key=`tv:${movie.id}:${ep}`,size=candidateEpisodeSize(seed,ep);return !planned.has(key) &&
        (!known.has(key) || (baseline(key)>0 && size>baseline(key)+1e-8)) && size+1e-8 >= bestAvailable.get(key);}).map(ep=>`tv:${movie.id}:${ep}`);
      const missing = useful.filter(key=>!known.has(key)).length;
      const overlap = seed.episodeKeys.filter(ep=>known.has(`tv:${movie.id}:${ep}`)||planned.has(`tv:${movie.id}:${ep}`)).length;
      return {seed,useful,missing,overlap};
    }).filter(choice=>choice.useful.length).sort((a,b)=>b.missing-a.missing || b.useful.length-a.useful.length || a.overlap-b.overlap || b.seed.episodeSizeGB-a.seed.episodeSizeGB || b.seed.updatedAt-a.seed.updatedAt);
    if (!choices.length) break;
    const choice = choices[0]; selected.push({...choice.seed,coverageReason:choice.missing ? `补齐 ${choice.missing} 集` : `升级 ${choice.useful.length} 集`});
    for (const key of choice.useful) planned.add(key);
  }
  return { candidates:[...selected,...opaque], unrecognized };
}
function episodeIdentity(title) {
  const text = normalizedEpisodeText(title);
  // 多集/整季资源不能用整包体积与单集比较。
  if (/全集|全\s*\d+\s*集|更新至|complete|S\d+E\d+\s*[-~至]\s*(?:S\d+)?E?\d+|E\d+\s*E\d+|第?\d+\s*[-~至]\s*\d+\s*集|EP?\d+\s*[-~至]\s*(?:EP?)?\d+/i.test(text)) return '';
  let match = text.match(/\bS(\d{1,2})[ ._-]*E(\d{1,3})(?!\d)/i) || text.match(/\b(\d{1,2})x(\d{1,3})(?!\d)/i);
  if (match) return `S${Number(match[1])}E${Number(match[2])}`;
  match = text.match(/第\s*(\d{1,3})\s*集/) || text.match(/(?:\bEP?)[ ._-]*(\d{1,3})(?!\d)/i);
  if (!match) return '';
  const season = text.match(/\bS(\d{1,2})(?!\d)/i) || text.match(/第\s*(\d{1,2})\s*季/);
  return `S${season ? Number(season[1]) : 1}E${Number(match[1])}`;
}

function saveMonitorMovieBest(item) {
  rememberResourceVersion(item);
  const config = readConfig();
  config.monitorMovieBest = config.monitorMovieBest || {};
  config.monitorSavedVersions = config.monitorSavedVersions || {};
  const key = item.selectionKey || item.movieId;
  const previous = config.monitorSavedVersions[key] || (config.monitorMovieBest[key] ? [config.monitorMovieBest[key]] : []);
  const version = { title: item.movieTitle, sizeGB: sizeInGb(item.size), size: item.size, url: item.url, time: new Date().toISOString() };
  config.monitorSavedVersions[key] = [...previous.filter(value => magnetKey(value.url) !== magnetKey(item.url)), version].slice(-32);
  config.monitorMovieBest[key] = config.monitorSavedVersions[key].slice().sort((a, b) => b.sizeGB - a.sizeGB)[0];
  writeConfig(config);
}

function parsePanSearch(raw, site) {
  try {
    const root = JSON.parse(raw);
    const data = root.data || root;
    const groups = data.merged_by_type || {};
    const results = [];
    for (const [type, list] of Object.entries(groups)) for (const item of Array.isArray(list) ? list : []) {
      const url = String(item.url || item.link || '').trim();
      if (!url) continue;
      let category = type;
      if (/^magnet:/i.test(url)) category = 'magnet'; else if (/^ed2k:/i.test(url)) category = 'ed2k'; else if (/115(?:\.com|cdn\.com)/i.test(url)) category = '115'; else if (/baidu\.com/i.test(url)) category = 'baidu';
      results.push({ title: String(item.note || item.title || url), url, site: String(item.source || site), date: String(item.datetime || item.date || ''), size: String(item.size || item.file_size || ''), type: category, code: String(item.password || item.code || '') });
    }
    return results;
  } catch (_) {
    return [...String(raw || '').matchAll(/(?:magnet:\?[^\s<>"']+|ed2k:\/\/[^\s<>"']+)/ig)].map(match => ({ title: match[0], url: match[0], site, type: /^ed2k/i.test(match[0]) ? 'ed2k' : 'magnet', date: '', size: '', code: '' }));
  }
}

async function fetchPanSearch(query, page = 1) {
  const sites = [
    ['聚合磁力源 A', 'https://pan.ailinux.de/api/search?kw={query}&page={page}'],
    ['聚合磁力源 B', 'https://so.252035.xyz/api/search?kw={query}&page={page}']
  ];
  const batches = await Promise.allSettled(sites.map(async ([name, template]) => {
    const url = template.replace('{query}', encodeURIComponent(String(query || ''))).replace('{page}', String(page));
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parsePanSearch(await response.text(), name);
  }));
  const results = batches.flatMap(item => item.status === 'fulfilled' ? item.value : []);
  const errors = batches.flatMap((item,index) => item.status === 'rejected' ? [sites[index][0]+': '+item.reason.message] : []);
  if (!results.length) {
    try {
      const catalog = await fetchCloudSearch(query, page);
      for (const movie of catalog.items.slice(0, 6)) {
        if (!movie.id) continue;
        let detail; try { detail = await fetchCloudDetail(movie.id); } catch(error) { errors.push(movie.title+': '+error.message); continue; }
        results.push(...(detail.clouds || []).map(item => ({...item,site:'不太灵资源库',title:item.title || movie.title})), ...(detail.seeds || []).map(item => ({...item,type:/^ed2k:/i.test(item.url)?'ed2k':'magnet',site:'不太灵资源库'})));
      }
      if (catalog.total > 6) errors.push('备用搜索仅读取当前页前6部影片，可在资源库搜索查看更多');
    } catch(error) { errors.push('不太灵备用搜索: '+error.message); }
  }
  if (!results.length && errors.length) throw new Error('搜索源暂不可用或未返回结果：'+errors.join('；'));
  return { items: results.filter((item, index, all) => all.findIndex(other => other.url === item.url) === index), warning: errors.length ? errors.join('；') : '' };
}

async function fetchMovieDetail(movieId) {
  if (!movieId) return null;
  if(String(movieId).startsWith('qm5:'))return getQmp4Provider().detail(movieId);
  if(String(movieId).startsWith('jy4:'))return getJyingProvider().detail(movieId);
  if(String(movieId).startsWith('bt3:'))return getBtbtlaProvider().detail(movieId);
  if(String(movieId).startsWith('gy:'))return getGuanyingProvider().detail(movieId);
  const result = await apiRequest(`${mirrorConfig().current}/prod/api/v1/getVideoDetail?${new URLSearchParams({ ...SITE_PARAMS, id: movieId })}`);
  if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '影片详情获取失败');
  return result.data || null;
}

function splitValues(value) {
  return String(value || '').split(/[、,，\/|]+/).map(item => item.trim()).filter(Boolean);
}
function containsAny(value, values) {
  const text = String(value || '').toLowerCase();
  return !values.length || values.some(item => text.includes(String(item).toLowerCase()));
}
function yearValue(detail) {
  const raw = String(detail?.niandai || detail?.years || detail?.year || detail?.release || '');
  return Number(raw.match(/(?:19|20)\d{2}/)?.[0] || 0);
}
function yearMatches(year, values) {
  if (!values.length) return true;
  const current = new Date().getFullYear();
  return values.some(value => {
    if (/^近三年$/.test(value)) return year >= current - 2;
    if (/^20年代$/.test(value)) return year >= 2020 && year <= 2029;
    if (/^10年代$/.test(value)) return year >= 2010 && year <= 2019;
    if (/^00年代$/.test(value)) return year >= 2000 && year <= 2009;
    if (/^90年代$/.test(value)) return year >= 1990 && year <= 1999;
    if (/^80年代$/.test(value)) return year >= 1980 && year <= 1989;
    if (/^更早$/.test(value)) return year > 0 && year < 1980;
    const exact = Number(value);
    return Number.isFinite(exact) && year === exact;
  });
}
function numericScore(detail) {
  return Number(detail?.doub_score || detail?.score || detail?.IMDB_score || 0) || 0;
}
function parseScoreRange(value) {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}
function sizeInGb(value) {
  const match = String(value || '').match(/([\d.,]+)\s*(TiB|GiB|MiB|KiB|TB|GB|MB|KB|B|T|G|M|K)(?![a-z])/i);
  if (!match) return 0;
  const raw = /^\d+,\d{1,2}$/.test(match[1]) ? match[1].replace(',', '.') : match[1].replace(/,/g, '');
  const number = Number(raw); if (!Number.isFinite(number) || number < 0) return 0;
  const unit = match[2].toUpperCase().replace('IB','B');
  return number * ({ T: 1024, TB: 1024, G: 1, GB: 1, M: 1 / 1024, MB: 1 / 1024, K: 1 / 1048576, KB: 1 / 1048576, B: 1 / 1073741824 }[unit] || 0);
}
function matchesMonitorFilters(item, detail, filters) {
  if (!detail) return !filters.onlyImdb && !filters.onlyCloud && !filters.genres.length && !filters.countries.length && !filters.years.length && !filters.qualities.length && !filters.tags.length && !filters.scoreRange && !filters.minSizeGB && !filters.maxSizeGB && !hasUpdateTimeFilter(filters);
  if (!containsAny(detail.class, filters.genres)) return false;
  if (!containsAny(detail.production_area, filters.countries)) return false;
  if (!yearMatches(yearValue(detail), filters.years)) return false;
  if (!containsAny(`${item.quality || ''} ${detail.quality || ''} ${detail.definition || ''} ${item.title}`, filters.qualities)) return false;
  if (!containsAny(detail.tags, filters.tags)) return false;
  const range = parseScoreRange(filters.scoreRange);
  if (range) { const score = numericScore(detail); if (score < range[0] || score > range[1]) return false; }
  if (filters.onlyImdb && !String(detail.IMDB_number || '').trim()) return false;
  if (filters.onlyCloud && !(Number(detail.wp_num || 0) > 0 || normalizeCloudDetail(detail).clouds.length > 0)) return false;
  if (filters.minSizeGB && sizeInGb(item.size) < filters.minSizeGB) return false;
  if (filters.maxSizeGB && sizeInGb(item.size) > filters.maxSizeGB) return false;
  if (!matchesUpdateTime(filters.dateMode==='minutes'?require('./monitor-time').updateValue(item):item.date, filters)) return false;
  return true;
}

async function getSiteCookie(origin = mirrorConfig().current) {
  try {
    const cookies = await session.fromPartition('persist:cloudsave').cookies.get({ url: origin });
    return cookies.map(item => `${item.name}=${item.value}`).join('; ');
  } catch (_) { return ''; }
}

function parse115Json(source) { return share115Api.parse115Json(source); }

async function apiRequest(url, options = {}, cookie = '') {
  if (shuttingDown) throw Object.assign(new Error('软件正在退出，未发起新请求'), { monitorCancelled:true });
  const requested = new URL(url);
  if (SITE_MIRRORS.includes(requested.origin) && requested.pathname.startsWith('/prod/api/') && (!options.method || options.method === 'GET')) {
    return cachedResourceRequest(requested.pathname + requested.search, options);
  }
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', ...(options.headers || {}) };
  let requestUrl = url;
  if (!cookie && /^https:\/\/www\.[0-9]+bt0\.com\//i.test(url)) {
    const saved = loadSiteSession();
    cookie = (saved.host === requested.hostname ? saved.cookie : '') || await getSiteCookie(requested.origin);
    if (saved.token && saved.host === requested.hostname) {
      headers.Authorization = `Bearer ${saved.token}`;
      // Android 客户端同时发送查询参数和 Authorization 请求头；部分镜像只读取查询参数。
      const parsed = new URL(url);
      parsed.searchParams.set('access_token', saved.token);
      requestUrl = parsed.toString();
    }
  }
  if (cookie) headers.Cookie = cookie;
  let response;
  try { response = await fetch(requestUrl, { ...options, headers, signal: AbortSignal.timeout(15000), redirect: 'manual' }); }
  catch (error) { throw new Error(`${requested.hostname}${requested.pathname}：${connectionMessage(error)}`); }
  if (response.status >= 300 && response.status < 400) throw new Error('服务器要求重新登录或发生了跳转');
  if (!response.ok) throw new Error(`服务器返回 HTTP ${response.status}`);
  const text = await response.text();
  try { return /(^|\.)115\.com$/.test(requested.hostname) ? parse115Json(text) : JSON.parse(text); } catch { throw new Error('服务器返回了无法识别的响应'); }
}

function check115(result) { share115Api.check115(result); }

function getAccount(cookie) { return share115Api.getAccount(apiRequest, cookie); }

function getFolders(cookie, cid = '0') { return share115Api.getFolders(apiRequest, cookie, cid); }

function defaultSaveFolder() {
  const folder = readConfig().folder;
  if (!folder) return { cid: '0', name: '根目录' };
  if (folder.requiresReselect || !/^\d+$/.test(String(folder.cid ?? ''))) throw new Error('保存目录无效或115账户已更换，请重新选择默认目录');
  return { ...folder, cid: String(folder.cid), name: String(folder.name || folder.cid) };
}
async function validateSaveFolder(cookie, folder, uid) { return share115Api.validateSaveFolder(apiRequest, cookie, folder, uid); }
function responseAccepted(result) {
  const value = result?.state ?? result?.success;
  return value === true || value === 1 || value === '1' || value === 'success';
}
function offlineHash(url) {
  const raw = String(url).match(/(?:urn:btih:)([a-z0-9]+)(?:&|$)/i)?.[1] || '';
  if (/^[a-f0-9]{40}$/i.test(raw)) return raw.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(raw)) return '';
  let bits = 0, accumulator = 0, hex = '';
  for (const char of raw.toUpperCase()) {
    accumulator = (accumulator << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; hex += ((accumulator >> bits) & 255).toString(16).padStart(2, '0'); accumulator &= (1 << bits) - 1; }
  }
  return hex;
}

function matchingOfflineTask(result, url, knownHash = '') {
  const data = result?.data;
  const lists = [result?.tasks, data?.tasks, data?.list, Array.isArray(data) ? data : null, result?.task ? [result.task] : null, data?.task ? [data.task] : null, data && !Array.isArray(data) ? [data] : null, result ? [result] : null];
  const hash = /^[a-f0-9]{40}$/i.test(knownHash) ? knownHash.toLowerCase() : offlineHash(url); const key = magnetKey(url);
  return lists.flatMap(list => Array.isArray(list) ? list : []).find(task =>
    hash && (task.info_hash || task.hash) ? String(task.info_hash || task.hash).toLowerCase() === hash : Boolean(task.url && magnetKey(task.url) === key)
  ) || null;
}
async function findOfflineTask(cookie, url, knownHash = '') {
  const hash = /^[a-f0-9]{40}$/i.test(knownHash) ? knownHash.toLowerCase() : offlineHash(url);
  if (hash) {
    let result;
    try { result = await apiRequest(`https://clouddownload.115.com/web/?ac=get_user_task&info_hash=${hash}`, {}, cookie); }
    catch (error) { appendMonitorLog('115单条状态查询失败，改用任务列表', 'warning', error.message); }
    if (result) {
    if (!responseAccepted(result) && /登录|验证/.test(String(result.error || result.msg || ''))) check115(result);
    const task = matchingOfflineTask(result, url, hash); if (task) return task;
    }
  }
  for (let page = 1; ; page++) {
    const result = await readOfflineTaskPage(cookie, page);
    check115(result); const task = matchingOfflineTask(result, url, hash); if (task) return task;
    const pages = Number(result.page_count || result.data?.page_count || 1); if (page >= pages) break;
  }
  return null;
}
let offlineListHost = 'https://clouddownload.115.com/web/?ac=task_lists';
async function readOfflineTaskPage(cookie, page) {
  const hosts = [offlineListHost, ...['https://clouddownload.115.com/web/?ac=task_lists', 'https://115.com/web/lixian/?ct=lixian&ac=task_lists'].filter(host => host !== offlineListHost)];
  let lastError;
  for (const host of hosts) {
    try { const result = await apiRequest(`${host}&page=${page}&page_size=100`, {}, cookie); check115(result); offlineListHost = host; return result; }
    catch (error) { lastError = error; if (cookie !== loadCookie()) throw error; }
  }
  throw lastError;
}
async function readCachedOfflineTask(cookie,value){
  const hash=String(value.infoHash||offlineHash(value.url||'')||'').toLowerCase();
  if(!/^[a-f0-9]{40}$/.test(hash))return null;
  const result=await apiRequest(`https://clouddownload.115.com/web/?ac=get_user_task&info_hash=${hash}`,{},cookie);
  check115(result);
  return matchingOfflineTask(result,value.url||`magnet:?xt=urn:btih:${hash}`,hash);
}
function updateSubmissionPlacement(entry, status, message) {
  if (pendingStatusUpdates && entry.id) {
    const previous = pendingStatusUpdates.get(entry.id);
    pendingStatusUpdates.set(entry.id, { ...previous, entry, status, message }); return;
  }
  const config = readConfig();
  const history = Array.isArray(config.submitHistory) ? config.submitHistory : [];
  const match = item => entry.historyId ? item.id === entry.historyId : item.url === entry.url && String(item.cid) === entry.cid && item.time === entry.historyTime;
  const row = history.slice().reverse().find(match);
  if (row) { row.status = status; row.message = message; }
  const database = resourceDatabase(); const stored = database.history.slice().reverse().find(match);
  if (stored) { stored.status = status; stored.message = message; }
  const resource = getDatabaseResource(database, `${entry.uid}|${magnetKey(entry.url)}`);
  if (resource) { updateResourceSizeIndex(`${entry.uid}|${magnetKey(entry.url)}`, resource, { ...resource, status }); resource.status = status; resource.updatedAt = new Date().toISOString(); resourceArchive?.save(database, `${entry.uid}|${magnetKey(entry.url)}`, resource); }
  writeResourceDatabase(database);
  config.submitHistory = history; writeConfig(config); notifySubmitHistoryUpdated();
}
function savePendingOffline(entry) {
  const config = readConfig();
  // Entries whose 115 task disappeared server-side are re-queued by every repair pass, so the list
  // needs a ceiling; config.json is rewritten on each append.
  config.offlinePlacementPending = [...(config.offlinePlacementPending || []).filter(item => !(item.uid === entry.uid && magnetKey(item.url) === magnetKey(entry.url))), entry].slice(-1000);
  writeConfig(config);
}
function removePendingOffline(entry) {
  if (pendingStatusUpdates?.has(entry.id)) {
    pendingStatusUpdates.get(entry.id).remove = true; return;
  }
  const config = readConfig(); config.offlinePlacementPending = (config.offlinePlacementPending || []).filter(item => item.id !== entry.id); writeConfig(config);
}
function finishOfflinePlacement(entry,status,message,resolution){
  updateSubmissionPlacement(entry,status,message);
  const config=readConfig();config.offlinePlacementResolved||={};config.offlinePlacementResolved[`${entry.uid}|${magnetKey(entry.url)}`]={historyId:entry.historyId||'',resolution,at:new Date().toISOString()};writeConfig(config);
  removePendingOffline(entry);
}
function unavailableOfflineOutput(entry){
  const message='115已完成下载；原输出已被整理、移动或删除，结束目录核对（未核实当前位置）';
  finishOfflinePlacement(entry,'unverified',message,'unavailable');appendMonitorLog(message,'warning','','115');return true;
}
let offlineOperationQueue = Promise.resolve();
let pendingStatusUpdates = null;
function flushPendingStatusUpdates() {
  if (!pendingStatusUpdates?.size) return;
  const config = readConfig(); const database = resourceDatabase(); let changed = false;
  const queueIndex = new Map((config.offlinePlacementPending || []).map(item => [item.id, item]));
  const localIndex = new Map((config.submitHistory || []).map(item => [item.id, item]));
  const historyIndex = new Map(database.history.map(item => [item.id, item]));
  const removedIds = new Set();
  for (const { entry, status = 'pending', message, remove } of pendingStatusUpdates.values()) {
    if (remove) removedIds.add(entry.id);
    const queued = queueIndex.get(entry.id);
    if (queued) { queued.lastCheckedAt = entry.lastCheckedAt; queued.lastCheckMessage = message; queued.nextCheckAt = entry.nextCheckAt || 0; queued.lastSyncError = entry.lastSyncError || ""; }
    for (const index of [localIndex, historyIndex]) {
      const row = index.get(entry.historyId);
      if (row && row.status === 'pending' && (row.message !== message || row.status !== status)) { row.message = message; row.status = status; changed = true; }
    }
    const resource = getDatabaseResource(database, `${entry.uid}|${magnetKey(entry.url)}`);
    if (resource && resource.status !== status) { updateResourceSizeIndex(`${entry.uid}|${magnetKey(entry.url)}`, resource, { ...resource, status }); resource.status = status; resource.updatedAt = new Date().toISOString(); changed = true; }
  }
  config.offlinePlacementPending = (config.offlinePlacementPending || []).filter(item => !removedIds.has(item.id));
  // Persist resolved history before removing queue entries, so interrupted writes can be retried.
  if (changed) writeResourceDatabase(database);
  writeConfig(config); pendingStatusUpdates.clear();
  if (changed) notifySubmitHistoryUpdated();
}
function serialOfflineOperation(task) {
  const pending = offlineOperationQueue.then(task); offlineOperationQueue = pending.catch(() => {}); return pending;
}
function offlineFileIdentity(file) {
  if (!file || typeof file !== 'object') return null;
  const fid = file.fid && String(file.fid) !== '0' ? String(file.fid) : '';
  const id = String(file.file_id ?? file.id ?? (fid || file.cid) ?? '');
  const parent = file.parent_id ?? file.pid ?? (fid || (file.file_id && String(file.cid) !== id) ? file.cid : undefined);
  if (!/^\d+$/.test(id) || parent === undefined || !/^\d+$/.test(String(parent))) return null;
  return { id, parent: String(parent) };
}
async function reconcileOfflinePlacement(cookie, entry, knownTask = undefined, preparedInfo = undefined) {
  const task = knownTask === undefined ? await findOfflineTask(cookie, entry.url, entry.taskHash || '') : knownTask;
  if (cookie !== loadCookie()) throw new Error('115账户已更换，已暂停目录核对');
  const reportPending = message => {
    entry.lastCheckedAt = new Date().toISOString();
    if (pendingStatusUpdates) { pendingStatusUpdates.set(entry.id, { entry, status: 'pending', message }); return; }
    const changed = entry.lastCheckMessage !== message; entry.lastCheckMessage = message; savePendingOffline(entry);
    if (changed) updateSubmissionPlacement(entry, 'pending', message);
  };
  if (!task) { reportPending('115任务列表未找到该任务，可能已被清理；尚不能确认保存完成，请在115检查'); return false; }
  if (Number(task.status) === -1) {
    const message = `115离线下载失败，资源尚未保存${task.status_text ? '：' + task.status_text : ''}`; updateSubmissionPlacement(entry, 'failed', message); removePendingOffline(entry);
    const config = readConfig();
    if (!config.monitorAccountUid || config.monitorAccountUid === entry.uid) {
      if (config.monitor?.seen) config.monitor.seen = config.monitor.seen.filter(key => key !== magnetKey(entry.url));
      for (const [key, best] of Object.entries(config.monitorMovieBest || {})) {
        const versions = (config.monitorSavedVersions?.[key] || [best]).filter(item => magnetKey(item.url) !== magnetKey(entry.url));
        if (config.monitorSavedVersions) config.monitorSavedVersions[key] = versions;
        if (versions.length) config.monitorMovieBest[key] = versions.slice().sort((a,b) => b.sizeGB - a.sizeGB)[0]; else delete config.monitorMovieBest[key];
      }
    }
    writeConfig(config); appendMonitorLog(message, 'error', entry.url);
    throw Object.assign(new Error(message), { offlineFailed: true, historyRecorded: true });
  }
  if (Number(task.status) !== 2) {
    const percent = Number(task.percentDone ?? task.display_percent);
    reportPending(`115${task.status_text || '正在处理离线任务'}${Number.isFinite(percent) ? ' · 进度 ' + Math.max(0, Math.min(100, percent)) + '%' : ''}${task.waiting_text ? ' · ' + task.waiting_text : ''}`);
    return false;
  }
  // Only the output ID returned by this exact task may be moved. Never match by filename or scan the root folder.
  const fileId = String(task.file_id || task.fid || task.data?.file_id || task.data?.fid || '');
  if (!/^\d+$/.test(fileId) || fileId === '0') {
    const message = '115任务已完成，但尚未返回输出文件ID，继续等待核对保存目录';
    if (entry.lastCheckMessage !== message) { entry.lastCheckMessage = message; savePendingOffline(entry); updateSubmissionPlacement(entry, 'pending', message); appendMonitorLog(message, 'warning', `${entry.name}（CID ${entry.cid}） · ${entry.url}`); }
    return false;
  }
  if (preparedInfo instanceof Error) throw preparedInfo;
  let info;
  try{info=preparedInfo===undefined?await apiRequest(`https://webapi.115.com/files/get_info?file_id=${fileId}`,{},cookie):preparedInfo;}
  catch(error){if(cookie===loadCookie()&&/不存在|已经删除|已删除/.test(error.message))return unavailableOfflineOutput(entry);throw error;}
  if (cookie !== loadCookie()) throw new Error('115账户已更换，已暂停目录核对');
  const infoMessage = String(info?.error || info?.error_msg || info?.msg || info?.message || '');
  if (!responseAccepted(info) && /不存在|已经删除|已删除/.test(infoMessage)) {
    return unavailableOfflineOutput(entry);
  }
  check115(info);
  const file = Array.isArray(info.data) ? info.data[0] : info.data;
  const identity = offlineFileIdentity(file);
  if (!identity || identity.id !== fileId) throw new Error('无法核对离线任务的文件ID或父目录，未执行移动');
  const parent = identity.parent;
  if (parent !== entry.cid) {
    if (parent !== '0') {
      const message = `115已完成下载；资源位于其他目录（CID ${parent}），保留整理位置，结束目录核对`;
      finishOfflinePlacement(entry,'success',message,'external');appendMonitorLog(message,'info','','115');return true;
    }
    let folder;try{folder=await validateSaveFolder(cookie,entry,entry.uid);}catch(error){if(cookie===loadCookie()&&/不存在|已经删除|已删除/.test(error.message)){const message='原目标文件夹不存在，已结束此任务目录纠正；请为后续任务重新选择默认文件夹';finishOfflinePlacement(entry,'placement_failed',message,'target_missing');appendMonitorLog(message,'warning','','115');return false;}throw error;}
    const conflict = JSON.stringify({ [fileId]: { action: 'keep_both' } });
    const body = new URLSearchParams({ fid: fileId, 'fid[0]': fileId, pid: folder.cid, conflict_policy: conflict });
    if (cookie !== loadCookie()) throw new Error('115账户已更换，已暂停目录纠正');
    const moved = await apiRequest('https://webapi.115.com/files/move', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, cookie); check115(moved);
    const after = await apiRequest(`https://webapi.115.com/files/get_info?file_id=${fileId}`, {}, cookie); check115(after);
    const relocated = Array.isArray(after.data) ? after.data[0] : after.data;
    const confirmed = offlineFileIdentity(relocated);
    if (!confirmed || confirmed.id !== fileId || confirmed.parent !== entry.cid) throw new Error('115尚未确认文件移动完成，将继续核对');
    appendMonitorLog('离线资源已纠正保存目录', 'success', `文件ID：${fileId} · 实际原目录：${parent} · 目标：${entry.name}（CID ${entry.cid}）`);
  }
  if (cookie !== loadCookie()) throw new Error('115账户已更换，已暂停目录核对');
  const message = `已确认保存至：${entry.name}（CID ${entry.cid}）`;
  finishOfflinePlacement(entry,'success',message,'confirmed');
  appendMonitorLog(message, 'success', `任务：${entry.url} · 文件ID：${fileId}`);
  return true;
}
let placementCheckRunning = false;
let placementCursor = 0;
let offlineSyncProgress = '尚未同步115状态';
function reportOfflineSync(message) {
  offlineSyncProgress = message;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('offline-sync-progress', message);
}
async function checkPendingOfflinePlacements(manual = false) {
  if (placementCheckRunning) return { running: true, message: offlineSyncProgress };
  placementCheckRunning = true;
  const counts = { checked: 0, saved: 0, failed: 0, pending: 0, missing: 0, errors: 0 };
  try {
    const cookie = loadCookie(); const entries = readConfig().offlinePlacementPending || [];
    if (!cookie) return { message: '请先登录115' };
    if (!entries.length) return { message: '没有待同步的离线任务' };
    const account = await getAccount(cookie);
    const eligible = entries.filter(entry => String(account.uid) === String(entry.uid) && (manual || !entry.nextCheckAt || entry.nextCheckAt <= Date.now()));
    const start = eligible.length ? placementCursor % eligible.length : 0;
    const relevant = [...eligible.slice(start), ...eligible.slice(0, start)];
    placementCursor += 40;
    let fileBudget = manual ? Infinity : 40;
    pendingStatusUpdates = new Map();
    const remaining = new Map(relevant.map(entry => [entry.id, entry]));
    for (let page = 1; remaining.size; page++) {
      if (cookie !== loadCookie()) throw new Error('115账户已更换，已停止同步');
      if (shuttingDown) throw new Error('软件退出，已停止状态同步');
      reportOfflineSync(`读取115任务第 ${page} 页 · 已匹配 ${relevant.length - remaining.size} / ${relevant.length} 条`);
      const result = await readOfflineTaskPage(cookie, page);
      const tasks = result.tasks || result.data?.tasks || result.data?.list || [];
      const tasksByHash = new Map(tasks.filter(task => task.info_hash || task.hash).map(task => [String(task.info_hash || task.hash).toLowerCase(), task]));
      const tasksByUrl = new Map(tasks.filter(task => task.url).map(task => [magnetKey(task.url), task]));
      const matched = [];
      for (const entry of [...remaining.values()]) {
        const hash = /^[a-f0-9]{40}$/i.test(entry.taskHash || '') ? entry.taskHash.toLowerCase() : offlineHash(entry.url);
        const candidate = tasksByHash.get(hash) || tasksByUrl.get(magnetKey(entry.url));
        const task = candidate ? matchingOfflineTask({ tasks: [candidate] }, entry.url, entry.taskHash || '') : null;
        if (!task) continue;
        if (Number(task.status) === 2 && fileBudget <= 0) { remaining.delete(entry.id); continue; }
        if (Number(task.status) === 2) fileBudget--;
        matched.push({ entry, task });
      }
      const prepared = new Map(); let nextRead = 0;
      const reads = matched.filter(({task}) => Number(task.status) === 2 && /^\d+$/.test(String(task.file_id || task.fid || task.data?.file_id || task.data?.fid || '')));
      await Promise.all(Array.from({ length: Math.min(2, reads.length) }, async () => {
        while (nextRead < reads.length) {
          const { entry, task } = reads[nextRead++];
          try {
            if (cookie !== loadCookie()) throw new Error('115账户已更换，已暂停目录核对');
            const id = String(task.file_id || task.fid || task.data?.file_id || task.data?.fid);
            prepared.set(entry.id, await apiRequest(`https://webapi.115.com/files/get_info?file_id=${id}`, {}, cookie));
          } catch (error) { prepared.set(entry.id, error); }
        }
      }));
      for (const { entry, task } of matched) {
        remaining.delete(entry.id); counts.checked++;
        try {
          // Reads and processing updates never wait behind new submissions. Only completed
          // tasks enter the mutation queue, because reconciliation may correct a root save.
          const done = Number(task.status) === 2
            ? await serialOfflineOperation(() => reconcileOfflinePlacement(cookie, entry, task, prepared.get(entry.id)))
            : await reconcileOfflinePlacement(cookie, entry, task);
          if (done) counts.saved++; else counts.pending++;
        } catch (error) {
          if (error.offlineFailed) counts.failed++;
          else { counts.errors++; if (!error.placementAttention) { if (entry.lastSyncError !== error.message) appendMonitorLog('离线状态同步待重试', 'warning', error.message); entry.lastSyncError = error.message; entry.nextCheckAt = Date.now() + 300000; pendingStatusUpdates.set(entry.id, {entry, status:'pending', message:'状态同步暂不可用，5分钟后重试：' + error.message}); } }
        }
        if (counts.checked % 10 === 0) { reportOfflineSync(`同步115状态 ${counts.checked} / ${relevant.length} · 已保存 ${counts.saved} · 失败 ${counts.failed} · 处理中 ${counts.pending}`); await waitResource(20); }
      }
      flushPendingStatusUpdates();
      if (page >= Number(result.page_count || result.data?.page_count || 1)) break;
      await waitResource(350);
    }
    for (const entry of remaining.values()) {
      if (cookie !== loadCookie()) throw new Error('115账户已更换，已停止同步');
      await reconcileOfflinePlacement(cookie, entry, null); counts.missing++;
    }
    flushPendingStatusUpdates();
    const message = `115状态同步完成：已确认保存 ${counts.saved}，处理中 ${counts.pending}，失败 ${counts.failed}，列表未找到 ${counts.missing}，需重试 ${counts.errors} · ${new Date().toLocaleString('zh-CN')}`;
    reportOfflineSync(message); appendMonitorLog(message, 'info'); return { ...counts, message };
  } catch (error) {
    const message = `115状态同步失败，将稍后重试：${error.message}`;
    reportOfflineSync(message); appendMonitorLog(message, 'warning'); return { ...counts, error: true, message };
  } finally {
    try { flushPendingStatusUpdates(); }
    finally { pendingStatusUpdates = null; placementCheckRunning = false; }
  }
}
async function enforceOfflineEpisodeSize(url,context,existing){
 const policy=require('./offline-episode-size').normalize(readConfig().offlineEpisodeSize||{});if(!policy.enabled||!policy.minGB&&!policy.maxGB)return;
 const title=context.title||existing?.title||'',info=context.movieInfo||existing?.movieInfo||{};
 const coverage=episodeCoverage(title,info),mode=existing?.mode||context.mode||(coverage?'tv':'');
 if(mode==='movie')return;if(mode!=='tv')throw Error('无法确认资源类型，未提交115；请在批量离线选择电影或电视剧');
 let files=context.raw?._episodeFiles||existing?.episodeFiles;
 if(!files?.hasFileList&&(context.raw?.zfiles?.length||existing?.torrentInfo))files=episodeFileInformation(context.raw?.zfiles?.length?context.raw:existing.torrentInfo,title,info);
 if(!files?.hasFileList&&(!coverage||coverage.opaque||coverage.keys.length>1)&&(context.movieId||existing?.movieId)){
  const id=context.movieId||existing.movieId,detail=await fetchMovieDetail(id),seed=normalizeCloudDetail(detail).seeds.find(x=>magnetKey(x.url)===magnetKey(url));
  if(!seed)throw Error('原网站未找到该磁力的文件清单，未提交115');
  const one={...detail,ecca:{},all_seeds:[seed.raw]},filters={...monitorConfig().filters,genres:[],countries:[],years:[],qualities:[],tags:[],scoreRange:'',onlyCloud:false,onlyImdb:false,minSizeGB:0,maxSizeGB:0,sizeRanges:{movie:{minSizeGB:0,maxSizeGB:0},tv:{minSizeGB:0,maxSizeGB:0}},dateMode:'recent',withinDays:0};
  await inspectTelevisionFiles({id,title:info.title||title},one,filters,()=>{if(shuttingDown)throw Error('程序正在退出');});files=seed.raw._episodeFiles;
 }
 require('./offline-episode-size').check(policy,{files,coverage,sizeGB:sizeInGb(context.size||existing?.size)});
}
function submitMagnet(cookie, url, cid, folderName, context = {}) {
  if(context.source==='auto'&&(readConfig().library115?.[context.website||'butailing']?.magnet ?? (readConfig().automation115?.magnet!==false))===false)return Promise.reject(Object.assign(Error('115自动磁力离线已关闭'),{monitorCancelled:true}));
  return serialOfflineOperation(async () => {
    let targetCid = String(cid ?? '');
    const recordContext = { ...context, folderName, uid: (String(cookie).match(/(?:^|;\s*)UID=(\d+)/) || [])[1] || '' };
    try {
      context.assertActive?.();
      if (!cookie) throw new Error('请先登录115，再提交离线任务');
      if (cookie !== loadCookie()) throw new Error('115账户已更换，请确认新账户的保存目录');
      if (!/^(magnet:\?|ed2k:\/\/)/i.test(String(url))) throw new Error('不是有效的磁力或电驴链接');
      const account = await getAccount(cookie);
      recordContext.uid = String(account.uid);
      const configured = defaultSaveFolder();
      const target = await validateSaveFolder(cookie, { cid: targetCid, name: folderName || (configured.cid === targetCid ? configured.name : targetCid), uid: configured.uid }, account.uid);
      recordContext.folderName = target.name;
      const existing = getDatabaseResource(resourceDatabase(), `${account.uid}|${magnetKey(url)}`);
      if (Number(existing?.status) === -1) throw new Error('该资源已有失败的115离线任务，请在115任务列表中处理后重试');
      if (existing?.status === 'uncertain') throw Object.assign(new Error('该磁力上次提交结果未确认，请先查看115任务，避免重复消耗额度'),{uncertain:true});
      if (existing && ACCEPTED_RESOURCE_STATES.has(existing.status)) {
        const message = '该磁力曾经添加过，原任务目录不会因重复提交而改变';
        recordSubmitHistory(url, 'duplicate', message, target.cid, recordContext); appendMonitorLog(message, 'info', `本次所选目录：${target.name}（CID ${target.cid}）`, context.website || (String(context.movieId).startsWith('gy:')?'guanying':'butailing')); return message;
      }
      if (cookie !== loadCookie()) throw new Error('115账户已更换，任务未提交');
      context.assertActive?.();
      await enforceOfflineEpisodeSize(url,context,existing);if(cookie!==loadCookie())throw Error('115账户已更换，任务未提交');context.assertActive?.();
      if(context.source==='auto'&&(readConfig().library115?.[context.website||'butailing']?.magnet ?? (readConfig().automation115?.magnet!==false))===false)throw Object.assign(Error('115自动磁力离线已关闭，未提交本条资源'),{monitorCancelled:true});
      const body = new URLSearchParams({ url: String(url).trim(), wp_path_id: target.cid });
      appendMonitorLog('开始提交115离线任务', 'info', `目标：${target.name} · CID：${target.cid} · 账户UID：${account.uid}\n链接：${url}`,context.website || (String(context.movieId).startsWith('gy:')?'guanying':'butailing'));
      let result;
      try { result = await apiRequest('https://clouddownload.115.com/web/?ac=add_task_url', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: 'https://115.com/', Origin: 'https://115.com/' }, body }, cookie); }
      catch(error) { throw Object.assign(new Error(`提交结果未确认，请先查看115离线任务，避免重复提交：${error.message}`), { uncertain: true }); }
      const message = String(result.error_msg || result.error || result.msg || result.message || '');
      if (/已存在|已添加|已经添加|已下载|重复任务|任务重复|重复下载|^重复$/.test(message)) {
        const duplicate = '该磁力曾经添加过，原任务目录不会因重复提交而改变'; recordSubmitHistory(url, 'duplicate', duplicate, target.cid, recordContext); return duplicate;
      }
      if (!responseAccepted(result)) { check115(result); throw new Error(message || '115未接受离线任务'); }
      const receipt = `115已接受提交，目标：${target.name}；本地记录用于去重与大小比较`;
      const row=recordSubmitHistory(url, 'pending', receipt, target.cid, recordContext);
      const latestConfig=readConfig();if(latestConfig.offlinePlacementResolved){delete latestConfig.offlinePlacementResolved[`${account.uid}|${magnetKey(url)}`];writeConfig(latestConfig);}
      savePendingOffline({id:crypto.randomUUID(),historyId:row.id,url:String(url).trim(),uid:String(account.uid),cid:target.cid,name:target.name,taskHash:offlineHash(url),createdAt:row.time,nextCheckAt:0});
      if(jsonStore)try{await jsonStore.flush();}catch(error){throw Object.assign(new Error('115已接受提交，但本地目录核对记录写入失败，请检查磁盘；勿重复提交'),{historyRecorded:true,uncertain:true});}
      cloudSubmitSync.trigger(String(account.uid),magnetKey(url));
      appendMonitorLog(receipt, 'info','',context.website || (String(context.movieId).startsWith('gy:')?'guanying':'butailing')); return receipt;
    } catch (error) { if (!error.historyRecorded && !error.monitorCancelled) recordSubmitHistory(url, error.uncertain ? 'uncertain' : 'failed', error.message || '提交失败', targetCid, recordContext); throw error; }
  });
}

let cachedPlacementRepair=null,cachedPlacementCursor=0;
function repairCachedOfflinePlacements(){
  if(cachedPlacementRepair)return cachedPlacementRepair;
  cachedPlacementRepair=serialOfflineOperation(async()=>{
    if(shuttingDown)return;
    const cookie=loadCookie(),uid=cookie.match(/(?:^|;\s*)UID=(\d+)/)?.[1]||'';if(!uid)return;
    const config=readConfig(),resolved=config.offlinePlacementResolved||{},queue=(config.offlinePlacementPending||[]).filter(x=>!resolved[x.uid+'|'+magnetKey(x.url)]),known=new Set(queue.map(x=>x.uid+'|'+magnetKey(x.url)));
    // Recover locally recorded submissions from versions that did not enqueue directory verification.
    for(const row of resourceDatabase().history){const key=row.uid+'|'+magnetKey(row.url);if(row.uid!==uid||row.status!=='pending'||!/^\d+$/.test(row.cid)||row.cid==='0'||known.has(key)||resolved[key])continue;queue.push({id:crypto.randomUUID(),historyId:row.id,url:row.url,uid,cid:row.cid,name:row.folderName||row.cid,taskHash:offlineHash(row.url),createdAt:row.time,nextCheckAt:0});known.add(key);}
    config.offlinePlacementPending=queue.slice(-1000);writeConfig(config);
    const snapshot=new Map(cloudDownloadCache.snapshot(uid).map(x=>[x.key,x])),eligible=queue.filter(x=>x.uid===uid&&(!x.nextCheckAt||x.nextCheckAt<=Date.now()));
    const start=eligible.length?cachedPlacementCursor%eligible.length:0;let directReads=0;
    for(let n=0;n<Math.min(20,eligible.length);n++){
      if(shuttingDown||cookie!==loadCookie())break;
      const entry=eligible[(start+n)%eligible.length],cached=snapshot.get(magnetKey(entry.url)),cachedHash=String(cached?.infoHash||offlineHash(cached?.url||'')).toLowerCase();if(cached?.state!=='completed'||cachedHash!==offlineHash(entry.url))continue;
      try{
        let task={info_hash:cachedHash,status:2,file_id:cached.fileId};
        if(!/^\d+$/.test(String(task.file_id||''))||task.file_id==='0'){if(directReads>=5)continue;directReads++;task=await readCachedOfflineTask(cookie,{...cached,url:entry.url});if(!task||Number(task.status)!==2)continue;}
        await reconcileOfflinePlacement(cookie,entry,task);
      }catch(error){if(!error.placementAttention){entry.nextCheckAt=Date.now()+300000;entry.lastSyncError=error.message;savePendingOffline(entry);appendMonitorLog('离线保存目录待重试','warning',error.message,'115');}}
    }
    cachedPlacementCursor+=20;
    if(jsonStore)await jsonStore.flush();
  }).catch(error=>appendMonitorLog('缓存目录核对失败，将稍后重试','warning',error.message,'115')).finally(()=>cachedPlacementRepair=null);
  return cachedPlacementRepair;
}

let monitorTimer = null,filterProbeTimer=null;
let monitorRunning = false, monitorStopRequested = false, monitorNextCheckAt=0;
let monitorProgressMessage = '';
let monitorPushTimer = null;
let pendingMonitorStatus = null;
function pendingOfflinePlacementCount(config = readConfig()) {
  const uid = String((loadCookie().match(/(?:^|;\s*)UID=(\d+)/) || [])[1] || '');
  if (!uid) return 0;
  const resolved = config.offlinePlacementResolved || {};
  const keys = new Set();
  for (const entry of Array.isArray(config.offlinePlacementPending) ? config.offlinePlacementPending : []) {
    if (String(entry?.uid || '') !== uid || !entry?.url) continue;
    const key = magnetKey(entry.url);
    if (key && !resolved[`${uid}|${key}`]) keys.add(key);
  }
  return keys.size;
}
function pushMonitorStatus(status) {
  if (status.running === true && status.lastMessage) monitorProgressMessage = status.lastMessage;
  const message = monitorRunning && status.running === undefined && monitorProgressMessage ? monitorProgressMessage : status.lastMessage;
  const { seen, ...display } = status;
  const outgoing = { nextCheckAt:monitorNextCheckAt?new Date(monitorNextCheckAt).toISOString():'', running: monitorRunning, ...display, pendingPlacementCount: pendingOfflinePlacementCount(), lastMessage: message };
  if (!jsonStore) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('monitor-status', outgoing); return; }
  pendingMonitorStatus = outgoing;
  if (!monitorPushTimer) monitorPushTimer = setTimeout(() => { monitorPushTimer = null; if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('monitor-status', pendingMonitorStatus); pendingMonitorStatus = null; }, 150);
}
function filterProbeInterval(config=monitorConfig()){return config.intervalMinutes*60000;}
function scheduleFilterProbe(){
  if(filterProbeTimer)clearTimeout(filterProbeTimer);filterProbeTimer=null;
  const config=monitorConfig();if(shuttingDown || !config.enabled || !config.filterBlockedSignature)return;
  const last=Date.parse(config.filterProbeLastAt || config.lastRun), due=Number.isFinite(last)?last+filterProbeInterval(config):(Date.parse(config.nextFilterProbeAt)||Date.now());
  if(Date.parse(config.nextFilterProbeAt)!==due)saveMonitor({nextFilterProbeAt:new Date(due).toISOString()});filterProbeTimer=setTimeout(()=>{filterProbeTimer=null;runMonitor(false);},Math.max(1000,due-Date.now()));
}
async function probeBlockedMonitor(config,signature){
  if(Date.parse(config.nextFilterProbeAt)>Date.now()){pushMonitorStatus({...config,running:false});return false;}
  monitorRunning=true;monitorStopRequested=false;const checkedAt=new Date().toISOString();
  const assertProbe=()=>{if(shuttingDown || monitorStopRequested || !monitorConfig().enabled || signature!==monitorScanSignature(monitorConfig().filters))throw Object.assign(new Error('筛选复查已停止'),{monitorCancelled:true});};
  try{
    assertProbe();appendMonitorLog('自动复查不太灵网站筛选：仅读取一个分类页，不读取影片详情');
    pushMonitorStatus({...config,running:true,lastMessage:'正在自动复查网站筛选，仅读取一个分类页…'});
    const checkpoint=readConfig().monitorScan,index=checkpoint?.modeIndex || 0,queries=monitorCatalogQueries(config.filters),probe=config.filterBlockedProbe || {mode:['movie','tv'][index%2],filters:queries[Math.floor(index/2)] || queries[0]};
    const batch=await fetchCloudCatalog(probe.mode,1,{...probe.filters,strictCatalog:true,withinDays:0,withinMinutes:0,dateMode:'recent',startDate:'',endDate:'',probeFresh:true});assertProbe();
    const year=String(probe.filters.years || '');if(/^\d{4}$/.test(year)&&batch.items.some(item=>item.year&&String(item.year)!==year)&&!nativeYearBatchCompatible(batch,year))throw Object.assign(new Error(`网站仍未按年份 ${year} 返回资源`),{filterRejected:true});
    const current=readConfig();if(current.monitorScan?.signature===signature)Object.assign(current.monitorScan,{page:1,pages:1,items:null,offset:0,phase:'scan'});writeConfig(current);
    saveMonitor({filterBlockedSignature:'',nextFilterProbeAt:'',filterBlockedProbe:null,filterProbeLastAt:checkedAt,failureStreak:0,nextRetryAt:'',lastMessage:batch.nativeYearScope?'已使用官网有限年份范围兼容筛选，自动继续监控':'网站筛选已恢复，自动继续监控'});
    appendMonitorLog(batch.nativeYearScope?'已启用官网有限年份范围兼容，自动继续按原条件监控':'网站筛选已恢复，自动继续按原条件监控','success');return true;
  }catch(error){
    if(error.monitorCancelled){saveMonitor({lastMessage:error.message});return false;}
    const next=new Date(Date.now()+filterProbeInterval(config)).toISOString(),message=`筛选复查未恢复：${error.message}；下次自动复查：${new Date(next).toLocaleString()}`;
    saveMonitor({filterProbeLastAt:checkedAt,nextFilterProbeAt:next,lastMessage:message});appendMonitorLog(message,'warning');return false;
  }finally{monitorRunning=false;scheduleFilterProbe();pushMonitorStatus({...monitorConfig(),running:false});}
}
async function runMonitor(manual = false) {
  if(!monitorConfig().scanOnly&&!libraryMagnetEnabled('butailing'))return {...monitorConfig(),lastMessage:'115自动磁力离线总开关已关闭'};
  if (monitorRunning) return { ...monitorConfig(), lastMessage: '监控检查正在进行中，请等待当前扫描', saved: 0, running: true };
  let config = monitorConfig();
  if (!config.enabled && !manual) return { message: '自动监控未开启', saved: 0 };
  if(config.filterBlockedSignature && config.filterBlockedSignature!==monitorScanSignature(config.filters)){saveMonitor({filterBlockedSignature:'',nextFilterProbeAt:'',filterBlockedProbe:null,nextRetryAt:''});scheduleFilterProbe();config=monitorConfig();}
  if (!manual && config.filterBlockedSignature === monitorScanSignature(config.filters)){if(!await probeBlockedMonitor(config,config.filterBlockedSignature))return {...monitorConfig(),running:false,saved:0};config=monitorConfig();}
  if (manual && config.filterBlockedSignature) {
    const current = readConfig();
    if (current.monitorScan) Object.assign(current.monitorScan, { modeIndex: 0, page: 1, items: null, offset: 0, phase: 'scan' });
    writeConfig(current);
    saveMonitor({ filterBlockedSignature: '', nextFilterProbeAt:'',filterBlockedProbe:null,nextRetryAt: '' });scheduleFilterProbe();
  }
  if (!manual && Date.parse(config.nextRetryAt) > Date.now()) return { ...config, running: false, message: '网络异常后的退避等待中' };
  const cookie = loadCookie();
  monitorRunning = true; monitorStopRequested=false;
  let saved = 0, submissionFailures = 0, duplicates = 0, signature = '';
  const startedEnabled = config.enabled;
  const assertActive = () => {
    if (monitorStopRequested) throw Object.assign(new Error('已停止扫描，断点已保留'), { monitorCancelled:true });
    if (shuttingDown) throw Object.assign(new Error('软件退出，已保留扫描断点'), { monitorCancelled:true });
    if (!config.scanOnly&&cookie !== loadCookie()) throw Object.assign(new Error('115账户已更换，本轮检查已停止'), { monitorCancelled: true });
    const current = monitorConfig();
    if ((startedEnabled || !manual) && !current.enabled) throw Object.assign(new Error('监控已关闭，本轮检查已停止；扫描进度已保留'), { monitorCancelled: true });
    if(current.autoSubmit!==config.autoSubmit)throw Object.assign(new Error('自动提交选项已更改，本轮扫描已停止；下次按新设置检查'),{monitorCancelled:true});
    if (signature && monitorScanSignature(current.filters) !== signature) throw Object.assign(new Error('筛选条件或网站登录状态已更改，本轮检查已停止；下轮按新条件扫描'), { monitorCancelled: true });
  };
  try {
    if (!cookie && config.autoSubmit) throw new Error('请先登录115，监控暂未执行');
    const account=config.autoSubmit?await getAccount(cookie):config.scanOnly?{uid:''}:{uid:readConfig().monitorAccountUid || cookie.match(/(?:^|;\s*)UID=(\d+)/)?.[1] || ''};assertActive();if(account.uid)bindMonitorAccount(account.uid);config=monitorConfig();signature=monitorScanSignature(config.filters);if(config.autoSubmit)await syncCloudDownloads();assertActive();
    const folder=config.scanOnly?{name:'仅本地采集'}:config.autoSubmit?await validateSaveFolder(cookie,defaultSaveFolder(),account.uid):defaultSaveFolder(); assertActive();
    appendMonitorLog(`开始扫描符合筛选的资源，目标目录：${folder.name}`);
    pushMonitorStatus({ ...config, lastMessage: '正在扫描符合筛选的资源…', running: true });
    const attemptedKeys = new Set(); let failures = 0;
    const submitCandidates = async (items, resumed) => {
      const eligibleMap = new Map(); const refreshed = new Set();
      for (const item of items) {
        assertActive();
        if(monitorSeenKeys().has(item.key)){duplicates++;continue;}
        if (resumed) {
          const movieKey = `${item.mode}:${item.movieId}`; if (refreshed.has(movieKey)) continue; refreshed.add(movieKey);
          try {
            const detail = await fetchMovieDetail(item.movieId); assertActive();
            if(item.mode==='tv'){await inspectTelevisionFiles({id:item.movieId,title:item.movieTitle},detail,monitorConfig().filters,assertActive);assertActive();}
            for (const candidate of selectMonitorCandidates(item.mode, { id: item.movieId, title: item.movieTitle }, detail, monitorConfig().filters).candidates) eligibleMap.set(candidate.candidateKey || candidate.selectionKey, candidate);
          } catch (error) {
            if (error.mirrorsExhausted || error.noMirrorRetry || error.monitorCancelled) throw error;
            failures++; appendMonitorLog(`断点候选 ${item.movieTitle} 核对失败，稍后重试`, 'warning', error.message);
          }
        } else eligibleMap.set(item.candidateKey || item.selectionKey, item);
      }
      for (const item of [...eligibleMap.values()].sort((a, b) => b.updatedAt - a.updatedAt)) {
        if (saved >= monitorConfig().filters.maxItems) return true;
        assertActive();
        if (attemptedKeys.has(item.key)) continue;
        attemptedKeys.add(item.key);
        if (monitorSeenKeys().has(item.key)) { duplicates++; continue; }
        try {
          pushMonitorStatus({ ...monitorConfig(), lastMessage: `边扫描边提交：${item.title || item.url}；已接受 ${saved} 条`, running: true });
          const currentFolder = defaultSaveFolder();
          const message = await submitMagnet(cookie, item.url, currentFolder.cid, currentFolder.name, { ...item, source: 'auto', title: item.title, assertActive });
          const seenAfterSubmit = new Set(monitorConfig().seen); seenAfterSubmit.add(item.key); saveMonitorMovieBest(item);
          if (/曾经添加过/.test(message)) { duplicates++; saveMonitor({ seen: [...seenAfterSubmit] }); appendMonitorLog(`已离线过，继续扫描补足数量：${item.movieTitle}`, 'info', item.url); continue; }
          saved++;
          saveMonitor({ seen: [...seenAfterSubmit], saved: (monitorConfig().saved || 0) + 1, lastMessage: `已向115提交 ${saved} 条任务（下载完成及目录落盘待核验），目标目录：${currentFolder.name}` });
          appendMonitorLog(`扫描期间115已接受任务：${item.title || item.url}`, 'info', `${item.url}\n提交目标：${currentFolder.name}（CID ${currentFolder.cid}）\n目录状态：${message}`);
        } catch (error) {
          if (error.monitorCancelled) throw error;
          submissionFailures++;
          appendMonitorLog(`提交失败：${item.title || item.url}`, 'error', error.message || '未知错误');
          if (/登录|Cookie|账户|保存目录|目录ID/.test(error.message)) throw error;
        }
      }
      return saved >= monitorConfig().filters.maxItems;
    };
    if(config.autoSubmit)await scanLocalCloudFallbacks('butailing',config.filters,assertActive,submitCandidates);
    const feeds = saved>=config.filters.maxItems ? Object.assign([],{scanned:0,quotaReached:true}) : await scanMonitorCatalog(config, assertActive,config.autoSubmit?submitCandidates:null); assertActive();
    failures += feeds.scanFailures || 0;
    appendMonitorLog(`本轮筛选扫描${feeds.quotaReached ? '已达到提交数量上限' : '完成'}：已检查 ${feeds.scanned} 部影片，已接受 ${saved} 条新任务${failures ? `；${failures} 部影片详情仍需重试` : ''}`, failures ? 'warning' : 'info');
    const remainder = feeds.filter(item => !attemptedKeys.has(item.key) && !monitorSeenKeys().has(item.key)).length;
    const message = !config.autoSubmit ? `仅扫描模式：已检查 ${feeds.scanned} 部影片，缓存 ${scanExportSnapshot().rows.length} 条磁力；自动提交已关闭，可导出扫描结果` : !feeds.length && !failures && !saved ? '当前筛选范围检查完成，没有符合条件且尚未提交的磁力' : `本次115接受 ${saved} 条新任务（提交成功不代表已下载到目标目录），重复跳过 ${duplicates} 条，提交失败或待确认 ${submissionFailures} 条${remainder ? `，数量限制剩余 ${remainder} 条` : ''}${failures ? `，详情待重试 ${failures} 部` : ''}；请在离线任务核对下载状态和实际保存目录`;
    // 保留提交错误的候选供补交；正常完成后从最新更新时间重新检查筛选范围。
    const recovery = readConfig().monitorScan?.recoveryPass || 0;
    if ((!submissionFailures && !failures) || recovery >= 1) clearMonitorScan(feeds.signature);
    else { const checkpoint = readConfig().monitorScan; if (checkpoint?.signature === feeds.signature) { checkpoint.recoveryPass = recovery + 1; checkpoint.phase = failures ? 'retry' : 'complete'; persistMonitorScan(checkpoint); } }
    const result = { ...monitorConfig(), lastRun: new Date().toISOString(), lastMessage: message, saved, submissionFailures, duplicates, error: submissionFailures > 0, running: false };
    saveMonitor({ lastRun: result.lastRun, lastMessage: message, failureStreak: 0, nextRetryAt: '' });
    appendMonitorLog(message, submissionFailures ? (saved ? 'warning' : 'error') : failures ? 'warning' : 'success');
    pushMonitorStatus(result);
    return result;
  } catch (error) {
    const checkpoint = readConfig().monitorScan; const streak = error.monitorCancelled ? 0 : monitorConfig().failureStreak + 1;
    const waitMinutes = Math.min(120, Math.max(config.intervalMinutes, 5 * 2 ** Math.min(streak - 1, 5)));
    const nextRetryAt = streak && !error.filterRejected ? new Date(Date.now() + waitMinutes * 60000).toISOString() : '';
    const progress = !error.monitorCancelled && checkpoint?.signature === signature ? `；已保留 ${checkpoint.candidates.length} 条候选及扫描断点，下次继续` : '';
    const message = `${error.message || '自动监控失败'}${progress}${error.filterRejected ? `；暂停资源扫描，按设定间隔每${config.intervalMinutes}分钟自动轻量复查筛选，恢复后自动继续` : ''}${nextRetryAt ? `；自动重试不早于 ${new Date(nextRetryAt).toLocaleString()}` : ''}`;
    const result = { ...monitorConfig(), lastRun: new Date().toISOString(), lastMessage: message, saved, error: !error.monitorCancelled, running: false, nextRetryAt };
    saveMonitor({ lastRun: result.lastRun, lastMessage: message, failureStreak: streak, nextRetryAt, filterBlockedSignature: error.filterRejected ? signature : '',nextFilterProbeAt:error.filterRejected?new Date(Date.now()+filterProbeInterval(config)).toISOString():'',filterBlockedProbe:error.filterRejected?(error.catalogProbe || null):null }); scheduleFilterProbe();appendMonitorLog(message, error.monitorCancelled ? 'info' : 'error'); pushMonitorStatus(result); return result;
  } finally { monitorRunning = false; }
}
function scheduleMonitor() {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null; monitorNextCheckAt=0;
  const config = monitorConfig();scheduleFilterProbe();
  if (!config.enabled) return;
  const interval=config.intervalMinutes * 60 * 1000;monitorNextCheckAt=Date.now()+interval;
  monitorTimer = setInterval(() => {monitorNextCheckAt=Date.now()+interval;runMonitor(false);}, interval);
}

let mainWindow;
let mainWindowLayout = { mobile: false, displayWidth: 0, displayHeight: 0 };
const loginWindowSize = (width, height) => require('./mobile-layout').contentWindowSize({ ...mainWindowLayout, width, height });
function configureChineseMenu(){
  if(!Menu)return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'文件',submenu:[{label:'退出',role:'quit'}]},
    {label:'编辑',submenu:[{label:'撤销',role:'undo'},{label:'重做',role:'redo'},{type:'separator'},{label:'剪切',role:'cut'},{label:'复制',role:'copy'},{label:'粘贴',role:'paste'},{label:'删除',role:'delete'},{type:'separator'},{label:'全选',role:'selectAll'}]},
    {label:'视图',submenu:[{label:'重新加载',role:'reload'},{label:'强制重新加载',role:'forceReload'},{label:'开发者工具',role:'toggleDevTools'},{type:'separator'},{label:'实际大小',role:'resetZoom'},{label:'放大',role:'zoomIn'},{label:'缩小',role:'zoomOut'},{type:'separator'},{label:'全屏',role:'togglefullscreen'}]},
    {label:'窗口',submenu:[{label:'最小化',role:'minimize'},{label:'关闭窗口',role:'close'}]}
  ]));
}
function createWindow() {
  const { screen } = require('electron');
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const profile = require('./mobile-layout').windowProfile({ displayWidth: workArea.width, displayHeight: workArea.height, force: process.env.CLOUDSAVE_MOBILE_LAYOUT === '1' });
  mainWindowLayout = { mobile: profile.mobile, displayWidth: workArea.width, displayHeight: workArea.height };
  // A 420px-wide desktop cannot show the Chinese menu bar without stealing the row the app needs.
  if (profile.mobile) Menu.setApplicationMenu(null); else configureChineseMenu();
  mainWindow = new BrowserWindow({ width: profile.width, height: profile.height, minWidth: profile.minWidth, minHeight: profile.minHeight, backgroundColor: '#f5f7fb', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling:false } });
  if (profile.fill) mainWindow.maximize();
  backgroundWindow=require('./background-window').installBackgroundWindow({app,win:mainWindow,Tray,Menu,nativeImage,isQuitting:()=>quittingAfterFlush,read:()=>readConfig().windowBehavior || {},write:value=>{const config=readConfig();config.windowBehavior=value;writeConfig(config);}});
  mainWindow.loadFile(path.join(__dirname, 'index.html')).catch(error => dialog.showErrorBox('界面加载失败', '请检查程序文件是否完整。\n' + error.message));
  // Only this window carries the preload bridge, so it must stay inside the application files; links are handed to the system browser instead.
  const appRootUrl = pathToFileURL(`${__dirname}${path.sep}`).href;
  mainWindow.webContents.on('will-navigate', (event, target) => { if (!target.startsWith(appRootUrl)) event.preventDefault(); });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
  mainWindow.on('closed',()=>{if(process.platform!=='darwin')app.quit();});
}

// Every privileged channel is reached only through preload.js, which Electron attaches to the main window alone.
// Installing the sender check here keeps it ahead of the first registration below.
const { pathToFileURL } = require('url');
const { createSenderChecker, installIpcGuard } = require('./ipc-guard');
const { waitForQuitIdle } = require('./quit-wait');
installIpcGuard(ipcMain, createSenderChecker(__dirname), (channel, event) => appendMonitorLog('已拒绝来自应用界面之外的调用', 'warning', `${channel} · ${event?.senderFrame?.url || '未知来源'}`));

ipcMain.handle('runtime-version', () => applicationVersion);
ipcMain.handle('background-settings',(_event,value)=>backgroundWindow?.settings(value) || {closeToTray:true,minimizeToTray:false,trayAvailable:false});
ipcMain.handle('get-library-preferences', () => readConfig().libraryPreferences || { searchHistory: [], posterWidth: 130 });
ipcMain.handle('set-library-preferences', (_event, preferences = {}) => {
  const config = readConfig(), previous = config.libraryPreferences || {};
  config.libraryPreferences = { searchHistory: Array.isArray(preferences.searchHistory) ? [...new Set(preferences.searchHistory.map(value=>String(value).trim()).filter(Boolean))].slice(0,80) : previous.searchHistory || [], qmp4PosterWidth:Math.max(80,Math.min(220,Number(preferences.qmp4PosterWidth || previous.qmp4PosterWidth)||130)),jyingPosterWidth:Math.max(80,Math.min(220,Number(preferences.jyingPosterWidth || previous.jyingPosterWidth)||130)),btbtlaPosterWidth:Math.max(80,Math.min(220,Number(preferences.btbtlaPosterWidth || previous.btbtlaPosterWidth)||130)), guanyingPosterWidth:Math.max(80,Math.min(220,Number(preferences.guanyingPosterWidth || previous.guanyingPosterWidth)||130)), posterWidth: Math.max(100,Math.min(220,Number(preferences.posterWidth || previous.posterWidth)||130)) };
  writeConfig(config); return config.libraryPreferences;
});
ipcMain.handle('get-state', () => ({ cookie: Boolean(loadCookie()), folder: readConfig().folder || { cid: '0', name: '根目录' } }));
const nativeLibraryPages=new (require('./filtered-library-pages').FilteredLibraryPages)();
async function fetchNativeLibraryPage(mode,requestedPage,filters={}){
 const page=Math.max(1,Math.floor(Number(requestedPage)||1)),options={...filters,strictCatalog:true,withinDays:0,withinMinutes:0,dateMode:'recent',startDate:'',endDate:''};
 const year=/^\d{4}$/.test(String(filters.years||filters.yearsCustom||''))?String(filters.years||filters.yearsCustom):'',localStatus=mode==='tv'&&['更新中','已完结'].includes(filters.status);
 if(year||localStatus){
  const key=crypto.createHash('sha256').update(JSON.stringify([mirrorConfig().current,readConfig().siteSession||{},mode,options])).digest('hex');
  return nativeLibraryPages.get(key,page,index=>fetchCloudCatalog(mode,index,options),item=>(!year||item.year===year)&&(!localStatus||Boolean(item.updateText)&&(filters.status==='更新中'?item.updateText.includes('更新至')&&!item.updateText.includes('全'):item.updateText.includes('全'))),()=>shuttingDown);
 }
 const batch=await fetchCloudCatalog(mode,page,options);
 return {...batch,page,nativePagination:true,nativeItemCount:batch.items.length,hasNext:page*batch.limit<batch.total};
}
ipcMain.handle('cloud-catalog',(_event,mode,page,filters)=>fetchNativeLibraryPage(mode || 'movie',page,filters || {}));
ipcMain.handle('cloud-search',async(_event,query,requestedPage)=>{const page=Math.max(1,Math.floor(Number(requestedPage)||1));return {...await fetchCloudSearch(String(query || ''),page),page,nativePagination:true};});
ipcMain.handle('cloud-filters', () => fetchCloudFilters());
ipcMain.handle('cloud-detail', (_event, id,fresh) => fetchCloudDetail(String(id || ''),Boolean(fresh)));
ipcMain.handle('mirror-state', () => mirrorConfig());
ipcMain.handle('set-mirror', (_event, current, autoSwitch) => setMirror(String(current), autoSwitch));
ipcMain.handle('check-mirrors', async () => {
  const result = await queuedResourceRequest(() => requestWithMirrors(`/prod/api/v1/getTList?${new URLSearchParams({ ...SITE_PARAMS, sc: '1', page: '1' })}`, {}, true));
  if (!result.success || Number(result.code) !== 200) throw new Error(result.message || '当前镜像资源接口异常，请手动选择其他镜像');
  return mirrorConfig();
});

let siteLoginWindow = null;
let siteLoginResult = null;
const GUANYING_ORIGIN = 'https://www.xn--wcv59z.com';
let guanyingLoginWindow = null;
let guanyingLoginResult = null;
let guanyingSessionRestored=false, guanyingProvider;
function getGuanyingProvider(){return guanyingProvider ||= new (require('./guanying-provider').GuanyingProvider)({BrowserWindow,restoreSession:restoreGuanyingSession,prepareSession:win=>getGuanyingSessionManager().prepare(win),captureSession:win=>getGuanyingSessionManager().capture(win),getInterval:()=>readConfig().guanyingRequestIntervalMs || 3000,diskCache:catalogDiskCache,cacheContext:()=>readConfig().guanyingSession?.savedAt || '',log:(message,level,details)=>appendMonitorLog(message,level,details,'guanying')});}
let guanyingSessionManager;
function getGuanyingSessionManager(){return guanyingSessionManager ||= new (require('./guanying-session').GuanyingSession)({partition:session.fromPartition('persist:cloudsave-guanying'),origin:GUANYING_ORIGIN,read:()=>readConfig().guanyingSession,save:value=>{const c=readConfig();c.guanyingSession=value;writeConfig(c);},encrypt:encryptSecret,decrypt:decryptSecret,log:(m,l)=>appendMonitorLog(m,l,'','guanying')});}
async function restoreGuanyingSession(){
 const webSession=session.fromPartition('persist:cloudsave-guanying');
 if(webSession.protocol?.handle && webSession.fetch)require('./remote-page').configureRemotePageSession(webSession,{host:new URL(GUANYING_ORIGIN).hostname,preferNative:true});
 await getGuanyingSessionManager().restore();guanyingSessionRestored=true;
}
ipcMain.handle('guanying-login-window', async () => {
  if (guanyingLoginWindow && !guanyingLoginWindow.isDestroyed()) { guanyingLoginWindow.focus(); return guanyingLoginResult; }
  await restoreGuanyingSession();
  const webSession=session.fromPartition('persist:cloudsave-guanying');
  const win = new BrowserWindow({ ...loginWindowSize(1050, 800), title: '登录观影', webPreferences: { partition: 'persist:cloudsave-guanying', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  guanyingLoginWindow = win;
  let closing = false, accessReady=false;
  const capture = async () => {
    if (win.isDestroyed() || new URL(win.webContents.getURL()).origin !== GUANYING_ORIGIN) return;
    if(await getGuanyingSessionManager().prepare(win)){await win.loadURL(win.webContents.getURL());return;}
    await getGuanyingSessionManager().capture(win);
    accessReady=await win.webContents.executeJavaScript(`(()=>{const body=document.body?.innerText || '';return Boolean(document.querySelector('main')) && location.pathname!=='/user/login' && !/登录后访问受限内容|浏览器安全验证|正在准备验证/.test(body);})()`).catch(()=>false);
    if(accessReady)guanyingProvider?.verificationCompleted();
  };
  guanyingLoginResult = new Promise(resolve => {
    win.on('close', event => { if (closing) return; event.preventDefault(); closing = true; capture().catch(() => {}).finally(() => win.destroy()); });
    win.on('closed', () => { guanyingLoginWindow = null; appendMonitorLog('观影浏览器已关闭，网站会话保存在本地；账号有效期由网站决定', 'info', '', 'guanying'); resolve({ sessionSaved: Boolean(readConfig().guanyingSession?.cookies),accessReady }); });
  });
  win.webContents.on('did-finish-load', () => capture().catch(() => {}));
  win.webContents.on('will-navigate', (event, target) => { try { if (new URL(target).origin !== GUANYING_ORIGIN) event.preventDefault(); } catch (_) { event.preventDefault(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { try { if (new URL(url).origin === GUANYING_ORIGIN) win.loadURL(url).catch(() => {}); } catch (_) {} return { action: 'deny' }; });
  win.loadURL(guanyingProvider?.verificationUrl || GUANYING_ORIGIN + '/user/login').catch(error => appendMonitorLog('观影登录页加载失败', 'error', error.message, 'guanying'));
  return guanyingLoginResult;
});
ipcMain.handle('guanying-catalog',(_event,category,page,filters)=>browseCache.get('guanying',[category,page,filters || {}],()=>getGuanyingProvider().catalog(category,page,filters || {})));
ipcMain.handle('guanying-detail',(_event,id,fresh)=>fetchCloudDetail(id,Boolean(fresh)));
ipcMain.handle('guanying-clouds',(_event,id)=>getGuanyingProvider().clouds(id));
ipcMain.handle('guanying-torrent',async(_event,seed)=>{const result=await getGuanyingProvider().torrent(seed);if(result.zlink&&magnetKey(result.zlink)!==magnetKey(seed.zlink))throw new Error('种子详情磁力不一致');return result;});
ipcMain.handle('guanying-filters',()=>{const p=require('./guanying-provider');return {genres:p.GENRES,animeGenres:p.ANIME_GENRES,regions:p.REGIONS,languages:p.LANGUAGES,qualities:p.QUALITY};});
const GUANYING_EXPORT_FILE=()=>path.join(app.getPath('userData'),'guanying-scan-export.json');
function captureGuanyingMagnets(movie,detail,filters,snapshot,mode){
  filters=require('./monitor-size-ranges').sizeFilters(filters,mode||(/^(?:gy|bt3|jy4|qm5):(?:mv|doc|bundle|other):/.test(movie.id)?'movie':'tv'));
  const tools=scanExportTools(),normalized=normalizeCloudDetail(detail),rows=new Map(snapshot.rows.map(row=>[magnetKey(row.url),row])),database=resourceDatabase(),uid=String(readConfig().monitorAccountUid || '');
  const movieInfo={...detail};for(const key of ['all_seeds','clouds','movies_online_seed'])delete movieInfo[key];
  for(const seed of normalized.seeds)if(matchesMonitorFilters(seed,detail,filters)){
    const identity=`${uid}|${magnetKey(seed.url)}`,stored=getDatabaseResource(database,identity),row=mergeExportRecord(stored?.exportRecord || rows.get(magnetKey(seed.url)) || {},tools.exportRow(seed,{...normalized.movie,title:normalized.movie.title||movie.title}));
    rows.set(magnetKey(seed.url),row);mergeDatabaseResource(database,{...seed,uid,movieId:movie.id,mode:/^(?:gy|bt3|jy4|qm5):(?:mv|doc|bundle|other):/.test(movie.id)?'movie':'tv',movieInfo,seedInfo:seed.raw,exportRecord:row},stored?.status || 'scanned');
  }
  snapshot.rows=[...rows.values()];writeResourceDatabase(database);
}
const snapshotStore = require('./snapshot-store');
const guanyingMonitor=new (require('./guanying-monitor').GuanyingMonitor)({
  readConfig,writeConfig,provider:getGuanyingProvider,uid:()=>readConfig().monitorAccountUid || '',sessionStamp:()=>readConfig().guanyingSession?.savedAt || '',cookie:loadCookie,account:getAccount,bindAccount:bindMonitorAccount,syncDownloads:syncCloudDownloads,scanFallbacks:(filters,active,onCandidates,categories)=>scanLocalCloudFallbacks('guanying',filters,active,onCandidates,categories),validateFolder:validateSaveFolder,folder:defaultSaveFolder,shuttingDown:()=>shuttingDown,
  select:selectMonitorCandidates,inspectFiles:inspectTelevisionFiles,seen:monitorSeenKeys,submit:submitMagnet,remember:saveMonitorMovieBest,capture:captureGuanyingMagnets,
  readSnapshot:()=>snapshotStore.readSnapshot(fs,GUANYING_EXPORT_FILE(),message=>appendMonitorLog('观影扫描结果不可用，本轮按空结果重新扫描','warning',message,'guanying')),
  writeSnapshot:value=>{if(jsonStore)jsonStore.set(GUANYING_EXPORT_FILE(),value);else snapshotStore.writeSnapshot(fs,GUANYING_EXPORT_FILE(),value);},
  log:(message,level='info',details='')=>appendMonitorLog(message,level,details,'guanying'),publish:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('guanying-monitor-status',state);}
});
ipcMain.handle('guanying-monitor-state',()=>guanyingMonitor.state());
ipcMain.handle('guanying-monitor-save',(_event,value)=>{const state=guanyingMonitor.update(value || {});syncScanOnlyTasks('guanying');return state;});
ipcMain.handle('guanying-monitor-run',()=>guanyingMonitor.run(true));
ipcMain.handle('guanying-monitor-stop',()=>guanyingMonitor.stop());
let guanyingExportRunning=false;
ipcMain.handle('guanying-export',async()=>{
  if(guanyingExportRunning)throw new Error('观影扫描结果正在导出');const snapshot=guanyingMonitor.snapshot();if(!snapshot.rows.length)throw new Error('暂无观影扫描结果，请先扫描');
  guanyingExportRunning=true;
  try{
    const choice=await dialog.showSaveDialog(mainWindow,{title:'导出观影扫描磁力',defaultPath:`观影扫描磁力-${exportFilenameStamp()}.xlsx`,filters:[{name:'Excel工作簿',extensions:['xlsx']}]});if(choice.canceled)return {canceled:true};
    const rows=JSON.parse(JSON.stringify(snapshot.rows)),uid=String(readConfig().monitorAccountUid || ''),movies=new Map();let missing=0;
    for(let i=0;i<rows.length;i++){
      const row=rows[i];exportProgress(`观影 ${i+1}/${rows.length}：优先读取本地资源信息`);
      const stored=getDatabaseResource(resourceDatabase(),`${uid}|${magnetKey(row.url)}`);
      if(stored){const result=await hydrateHistoryResource(uid,magnetKey(row.url),false,movies);rows[i]=mergeExportRecord(result.row,row);}
      if(scanExportTools().MEDIA_KEYS.some(key=>!rows[i].media?.[key]))missing++;
    }
    const target=/\.xlsx$/i.test(choice.filePath)?choice.filePath:choice.filePath+'.xlsx';if(jsonStore)await jsonStore.xlsx(target,rows);else fs.writeFileSync(target,scanExportTools().buildXlsx(rows));
    appendMonitorLog(`已导出观影扫描磁力 ${rows.length} 条`,'info',`媒体信息未齐全 ${missing} 条，缺失字段留空。`,'guanying');return {path:target,count:rows.length,missing};
  }finally{guanyingExportRunning=false;}
});
let btbtlaProvider,btbtlaExportRunning=false;
function getBtbtlaProvider(){return btbtlaProvider ||=new (require('./btbtla-provider').BtbtlaProvider)({BrowserWindow,diskCache:catalogDiskCache,getInterval:()=>readConfig().btbtlaRequestIntervalMs || 3000,stopped:()=>shuttingDown,log:(m,l,d)=>appendMonitorLog(m,l,d,'btbtla')});}
const BTBTLA_EXPORT_FILE=()=>path.join(app.getPath('userData'),'btbtla-scan-export.json');
const btbtlaMonitor=new (require('./guanying-monitor').GuanyingMonitor)({
  website:'btbtla',label:'BT影视',namespace:'bt3:',filters:async options=>{const filters=require('./guanying-monitor').legacyFilters(options),choices=await getBtbtlaProvider().filters();filters.genres=[];if(options.genre&&options.genre!=='0'){const match=choices.genre.find(row=>row.value===options.genre);if(!match)throw Error('BT影视类型条件已变更，请重新选择');filters.genres=[match.label];}filters.years=[];if(options.year&&options.year!=='0'){const match=choices.year.find(row=>row.value===options.year);if(!match)throw Error('BT影视年份条件已变更，请重新选择');if(/^\d{4}$/.test(match.label))filters.years=[match.label];}return filters;},catalogPath:require('./btbtla-provider').catalogPath,
  readConfig:()=>{const c=readConfig();return {...c,guanyingMonitor:c.btbtlaMonitor,guanyingScan:c.btbtlaScan};},
  writeConfig:value=>{const c=readConfig();c.btbtlaMonitor=value.guanyingMonitor;if(value.guanyingScan)c.btbtlaScan=value.guanyingScan;else delete c.btbtlaScan;writeConfig(c);},
  provider:getBtbtlaProvider,uid:()=>readConfig().monitorAccountUid || '',sessionStamp:()=>'',cookie:loadCookie,account:getAccount,bindAccount:bindMonitorAccount,syncDownloads:syncCloudDownloads,
  scanFallbacks:(filters,active,submit,categories)=>scanLocalCloudFallbacks('btbtla',filters,active,submit,categories),validateFolder:validateSaveFolder,folder:defaultSaveFolder,shuttingDown:()=>shuttingDown,
  select:selectMonitorCandidates,inspectFiles:inspectTelevisionFiles,seen:monitorSeenKeys,submit:submitMagnet,remember:saveMonitorMovieBest,capture:captureGuanyingMagnets,
  readSnapshot:()=>snapshotStore.readSnapshot(fs,BTBTLA_EXPORT_FILE(),message=>appendMonitorLog('BT影视扫描结果不可用，本轮按空结果重新扫描','warning',message,'btbtla')),
  writeSnapshot:value=>{if(jsonStore)jsonStore.set(BTBTLA_EXPORT_FILE(),value);else snapshotStore.writeSnapshot(fs,BTBTLA_EXPORT_FILE(),value);},
  log:(m,l='info',d='')=>appendMonitorLog(m,l,d,'btbtla'),publish:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('btbtla-monitor-status',state);}
});
ipcMain.handle('btbtla-catalog',(_e,category,page,filters)=>browseCache.get('btbtla',[category,Number(page)||1,filters || {}],()=>getBtbtlaProvider().catalog(category,Number(page)||1,filters)));
ipcMain.handle('btbtla-detail',(_e,id,fresh)=>fetchCloudDetail(id,fresh));
ipcMain.handle('btbtla-torrent',(_e,seed)=>getBtbtlaProvider().torrent(seed));
ipcMain.handle('btbtla-filters',()=>getBtbtlaProvider().filters());
ipcMain.handle('btbtla-monitor-state',()=>btbtlaMonitor.state());
ipcMain.handle('btbtla-monitor-save',(_e,value)=>{const state=btbtlaMonitor.update(value || {});syncScanOnlyTasks('btbtla');return state;});
ipcMain.handle('btbtla-monitor-run',()=>btbtlaMonitor.run(true));
ipcMain.handle('btbtla-monitor-stop',()=>btbtlaMonitor.stop());
ipcMain.handle('btbtla-export',async()=>{if(btbtlaExportRunning)throw Error('BT影视导出正在进行');const snapshot=btbtlaMonitor.snapshot();if(!snapshot.rows.length)throw Error('暂无BT影视扫描结果，请先检查资源');btbtlaExportRunning=true;try{const choice=await dialog.showSaveDialog(mainWindow,{title:'导出BT影视扫描磁力',defaultPath:`BT影视扫描磁力-${exportFilenameStamp()}.xlsx`,filters:[{name:'Excel工作簿',extensions:['xlsx']}]});if(choice.canceled)return {canceled:true};const rows=JSON.parse(JSON.stringify(snapshot.rows)),uid=String(readConfig().monitorAccountUid || ''),movies=new Map();for(let i=0;i<rows.length;i++){const stored=getDatabaseResource(resourceDatabase(),`${uid}|${magnetKey(rows[i].url)}`);if(stored){const value=await hydrateHistoryResource(uid,magnetKey(rows[i].url),false,movies);rows[i]=mergeExportRecord(value.row,rows[i]);}}const target=/\.xlsx$/i.test(choice.filePath)?choice.filePath:choice.filePath+'.xlsx';if(jsonStore)await jsonStore.xlsx(target,rows);else fs.writeFileSync(target,scanExportTools().buildXlsx(rows));return {path:target,count:rows.length};}finally{btbtlaExportRunning=false;}});
let jyingProvider,jyingLoginWindow,jyingSessionRestored=false,jyingExportRunning=false;
async function restoreJyingSession(){if(jyingSessionRestored)return;jyingSessionRestored=true;const stored=readConfig().jyingSession;if(!stored?.cookies)return;try{const cookies=JSON.parse(decryptSecret(stored.cookies));for(const cookie of cookies){const host=String(cookie.domain || '').replace(/^\./,'');if(!['jying.top','www.jying.top'].includes(host)||cookie.expirationDate&&cookie.expirationDate<Date.now()/1000)continue;await session.fromPartition('persist:cloudsave-jying').cookies.set({url:'https://'+host,name:cookie.name,value:cookie.value,path:cookie.path || '/',secure:cookie.secure,httpOnly:cookie.httpOnly,...(!cookie.hostOnly?{domain:cookie.domain}:{}),...(cookie.expirationDate?{expirationDate:cookie.expirationDate}:{})});}}catch(_){appendMonitorLog('聚影旧会话无法恢复，请重新登录','warning','','jying');}}
function getJyingProvider(){return jyingProvider ||=new (require('./jying-provider').JyingProvider)({diskCache:catalogDiskCache,context:()=>readConfig().jyingSession?.savedAt || '',readCooldown:()=>readConfig().jyingRateLimit||{},writeCooldown:value=>{const c=readConfig();c.jyingRateLimit=value;writeConfig(c);},getInterval:()=>readConfig().jyingRequestIntervalMs || 3000,stopped:()=>shuttingDown,fetcher:(url,options)=>session.fromPartition('persist:cloudsave-jying').fetch(url,options),getAuth:async()=>{await restoreJyingSession();if(jyingLoginWindow&&!jyingLoginWindow.isDestroyed())await captureJyingSession(jyingLoginWindow); const stored=readConfig().jyingSession || {},cookies=await session.fromPartition('persist:cloudsave-jying').cookies.get({url:'https://jying.top'});return {userAgent:stored.userAgent || mainWindow?.webContents.getUserAgent?.() || session.fromPartition('persist:cloudsave-jying').getUserAgent(),token:stored.token&&(!stored.expiresAt||stored.expiresAt>Date.now())?decryptSecret(stored.token):'',cookie:cookies.map(x=>x.name+'='+x.value).join('; '),csrf:cookies.find(x=>x.name==='csrftoken')?.value || ''};},refreshToken:token=>{const c=readConfig();c.jyingSession={...c.jyingSession,token:encryptSecret(token),expiresAt:Date.now()+7*86400000};writeConfig(c);}});}
async function captureJyingSession(win){
 if(!win||win.isDestroyed()||!/^https:\/\/(?:www\.)?jying\.top(?:\/|$)/.test(win.webContents.getURL()))return false;
 const auth=await win.webContents.executeJavaScript("({token:localStorage.getItem('app_user_token') || sessionStorage.getItem('app_user_token') || '',expiresAt:Number(localStorage.getItem('app_user_token_expires') || sessionStorage.getItem('app_user_token_expires') || 0)})");
 if(!auth.token || auth.expiresAt&&auth.expiresAt<Date.now())return false;
 const cookies=await session.fromPartition('persist:cloudsave-jying').cookies.get({}),c=readConfig(),previous=c.jyingSession || {};let changed=true;try{changed=decryptSecret(previous.token)!==auth.token;}catch(_){}
 if(!changed&&previous.expiresAt===auth.expiresAt&&previous.userAgent===win.webContents.getUserAgent()){try{if(decryptSecret(previous.cookies)===JSON.stringify(cookies.filter(x=>['jying.top','www.jying.top'].includes(x.domain.replace(/^\./,'')))))return true;}catch(_){}}
 c.jyingSession={...previous,token:encryptSecret(auth.token),expiresAt:auth.expiresAt,cookies:encryptSecret(JSON.stringify(cookies.filter(x=>['jying.top','www.jying.top'].includes(x.domain.replace(/^\./,''))))),userAgent:win.webContents.getUserAgent(),savedAt:changed?new Date().toISOString():previous.savedAt || new Date().toISOString()};writeConfig(c);if(changed&&mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('jying-session-updated');return true;
}
ipcMain.handle('jying-login-window',async()=>{
 if(jyingLoginWindow&&!jyingLoginWindow.isDestroyed()){jyingLoginWindow.focus();return jyingLoginWindow._result;}
 await restoreJyingSession();const win=new BrowserWindow({...loginWindowSize(1050,800),title:'聚影账号设置（登录后自动保存）',webPreferences:{partition:'persist:cloudsave-jying',contextIsolation:true,nodeIntegration:false,sandbox:true}});jyingLoginWindow=win;let closing=false,loggedIn=false;
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,target)=>{try{if(!['https://jying.top','https://www.jying.top'].includes(new URL(target).origin))event.preventDefault();}catch(_){event.preventDefault();}});
 const capture=()=>captureJyingSession(win).then(ok=>{loggedIn=ok;}).catch(()=>{});win.webContents.on('did-finish-load',capture);const timer=setInterval(capture,2000);
 win._result=new Promise(resolve=>{win.on('close',event=>{if(closing)return;event.preventDefault();closing=true;clearInterval(timer);capture().finally(()=>{if(!win.isDestroyed())win.destroy();});});win.on('closed',()=>{clearInterval(timer);jyingLoginWindow=null;resolve({loggedIn});});});win.loadURL('https://jying.top/login').catch(error=>appendMonitorLog('聚影登录窗口加载失败','warning',error.message,'jying'));return win._result;
});
const JYING_EXPORT_FILE=()=>path.join(app.getPath('userData'),'jying-scan-export.json');
let qmp4Provider,qmp4ExportRunning=false;const QMP4_EXPORT_FILE=()=>path.join(app.getPath('userData'),'qmp4-scan-export.json');
function getQmp4Provider(){return qmp4Provider ||=new (require('./qmp4-provider').Qmp4Provider)({fetchHtml:async (url,{signal}={})=>{const native=session.fromPartition('persist:cloudsave-qmp4');const ua=native.getUserAgent().replace(/\s(?:Electron|cloudsave-windows|CloudSave)\/\S+/gi,'');native.setUserAgent?.(ua);const r=await native.fetch(url,{bypassCustomProtocolHandlers:true,headers:{'User-Agent':ua},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});if(!r.ok)throw Error('七味读取失败（'+r.status+'）');if(new URL(r.url).origin!=='https://www.qmp4.com')throw Error('七味重定向异常');return r.text();},BrowserWindow,diskCache:catalogDiskCache,getInterval:()=>readConfig().qmp4RequestIntervalMs || 3000,stopped:()=>shuttingDown});}
const qmp4Monitor=new (require('./guanying-monitor').GuanyingMonitor)({website:'qmp4',label:'七味',namespace:'qm5:',categories:['mv','tv','ac','variety','short'],mode:category=>category==='mv'?'movie':'tv',nativeOptions:options=>options,
  filters:options=>require('./guanying-monitor').legacyFilters(options),catalogPath:require('./qmp4-provider').catalogPath,
  readConfig:()=>{const c=readConfig();return {...c,guanyingMonitor:c.qmp4Monitor,guanyingScan:c.qmp4Scan};},writeConfig:value=>{const c=readConfig();c.qmp4Monitor=value.guanyingMonitor;if(value.guanyingScan)c.qmp4Scan=value.guanyingScan;else delete c.qmp4Scan;writeConfig(c);},provider:getQmp4Provider,uid:()=>readConfig().monitorAccountUid || '',sessionStamp:()=>'',cookie:loadCookie,account:getAccount,bindAccount:bindMonitorAccount,syncDownloads:syncCloudDownloads,scanFallbacks:(f,a,s,c)=>scanLocalCloudFallbacks('qmp4',f,a,s,c),validateFolder:validateSaveFolder,folder:defaultSaveFolder,shuttingDown:()=>shuttingDown,select:selectMonitorCandidates,inspectFiles:inspectTelevisionFiles,seen:monitorSeenKeys,submit:submitMagnet,remember:saveMonitorMovieBest,capture:captureGuanyingMagnets,
  readSnapshot:()=>snapshotStore.readSnapshot(fs,QMP4_EXPORT_FILE(),message=>appendMonitorLog('七味扫描结果不可用，本轮按空结果重新扫描','warning',message,'qmp4')),writeSnapshot:value=>{if(jsonStore)jsonStore.set(QMP4_EXPORT_FILE(),value);else snapshotStore.writeSnapshot(fs,QMP4_EXPORT_FILE(),value);},log:(m,l='info',d='')=>appendMonitorLog(m,l,d,'qmp4'),publish:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('qmp4-monitor-status',state);}
});
ipcMain.handle('qmp4-catalog',(_e,category,page,filters)=>browseCache.get('qmp4',[category,Number(page)||1,filters || {}],()=>getQmp4Provider().catalog(category,Number(page)||1,filters)));
ipcMain.handle('qmp4-detail',async(_e,id,fresh)=>{const raw=await getQmp4Provider().detail(id,{fresh});return {...normalizeCloudDetail(raw),resourceAccessRequired:raw.resourceAccessRequired,resourceMessage:raw.resourceMessage,unavailableResourceCount:raw.unavailableResourceCount};});
ipcMain.handle('qmp4-clouds',(_e,id)=>getQmp4Provider().detail(id).then(normalizeCloudDetail).then(x=>x.clouds));ipcMain.handle('qmp4-torrent',(_e,seed)=>getQmp4Provider().torrent(seed));ipcMain.handle('qmp4-filters',()=>getQmp4Provider().filters());ipcMain.handle('qmp4-monitor-state',()=>qmp4Monitor.state());ipcMain.handle('qmp4-monitor-save',(_e,value)=>{const state=qmp4Monitor.update(value || {});syncScanOnlyTasks('qmp4');return state;});ipcMain.handle('qmp4-monitor-run',()=>qmp4Monitor.run(true));ipcMain.handle('qmp4-monitor-stop',()=>qmp4Monitor.stop());
ipcMain.handle('qmp4-export',async()=>{if(qmp4ExportRunning)throw Error('七味导出正在进行');const snapshot=qmp4Monitor.snapshot();if(!snapshot.rows.length)throw Error('暂无七味扫描结果，请先检查资源');qmp4ExportRunning=true;try{const result=await dialog.showSaveDialog(mainWindow,{title:'导出七味扫描磁力',defaultPath:`七味扫描磁力-${exportFilenameStamp()}.xlsx`,filters:[{name:'Excel工作簿',extensions:['xlsx']}]});if(result.canceled)return {canceled:true};const rows=snapshot.rows.map(row=>{const stored=getDatabaseResource(resourceDatabase(),String(readConfig().monitorAccountUid || '')+'|'+magnetKey(row.url));return mergeExportRecord(stored?.exportRecord || {},row);});const target=/\.xlsx$/i.test(result.filePath)?result.filePath:result.filePath+'.xlsx';if(jsonStore)await jsonStore.xlsx(target,rows);else fs.writeFileSync(target,scanExportTools().buildXlsx(rows));return {count:rows.length,path:target};}finally{qmp4ExportRunning=false;}});
const jyingMonitor=new (require('./guanying-monitor').GuanyingMonitor)({website:'jying',label:'聚影',namespace:'jy4:',categories:['mv','tv','ac','doc','variety','bundle','other'],mode:category=>['mv','doc','bundle','other'].includes(category)?'movie':'tv',nativeOptions:options=>({...options,res:options.onlyCloud?'115':options.res || 'MagnetLink'}),
  filters:async options=>{const f=require('./guanying-monitor').legacyFilters(options);f.genres=[];f.tags=[];if(options.genre||options.tag){const choices=await getJyingProvider().filters();if(options.genre){const x=choices.genre.find(x=>x.value===options.genre);if(!x)throw Object.assign(Error('聚影类型筛选已变更，请重新选择'),{filterRejected:true});f.genres=[x.label];}if(options.tag){const x=choices.tag.find(x=>x.value===options.tag);if(!x)throw Object.assign(Error('聚影标签筛选已变更，请重新选择'),{filterRejected:true});f.tags=[x.label];}}return f;},catalogPath:(category,page,options)=>'/api/app/movies/?'+new URLSearchParams(require('./jying-provider').catalogParams(category,page,options)),
  readConfig:()=>{const c=readConfig();return {...c,guanyingMonitor:c.jyingMonitor,guanyingScan:c.jyingScan};},writeConfig:value=>{const c=readConfig();c.jyingMonitor=value.guanyingMonitor;if(value.guanyingScan)c.jyingScan=value.guanyingScan;else delete c.jyingScan;writeConfig(c);},provider:getJyingProvider,uid:()=>readConfig().monitorAccountUid || '',sessionStamp:()=>readConfig().jyingSession?.savedAt || '',cookie:loadCookie,account:getAccount,bindAccount:bindMonitorAccount,syncDownloads:syncCloudDownloads,scanFallbacks:(f,a,s,c)=>scanLocalCloudFallbacks('jying',f,a,s,c),validateFolder:validateSaveFolder,folder:defaultSaveFolder,shuttingDown:()=>shuttingDown,select:selectMonitorCandidates,inspectFiles:inspectTelevisionFiles,seen:monitorSeenKeys,submit:submitMagnet,remember:saveMonitorMovieBest,capture:captureGuanyingMagnets,
  readSnapshot:()=>snapshotStore.readSnapshot(fs,JYING_EXPORT_FILE(),message=>appendMonitorLog('聚影扫描结果不可用，本轮按空结果重新扫描','warning',message,'jying')),writeSnapshot:value=>{if(jsonStore)jsonStore.set(JYING_EXPORT_FILE(),value);else snapshotStore.writeSnapshot(fs,JYING_EXPORT_FILE(),value);},log:(m,l='info',d='')=>appendMonitorLog(m,l,d,'jying'),publish:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('jying-monitor-status',state);}
});
ipcMain.handle('jying-catalog',(_e,category,page,filters)=>browseCache.get('jying',[category,Number(page)||1,filters || {}],()=>getJyingProvider().catalog(category,Number(page)||1,filters)));
ipcMain.handle('jying-detail',async(_e,id,fresh)=>{const raw=await getJyingProvider().detail(id,{fresh,allowLocked:true});return {...normalizeCloudDetail(raw),resourceAccessRequired:raw.resourceAccessRequired,resourceMessage:raw.resourceMessage,unavailableResourceCount:raw.unavailableResourceCount};});
ipcMain.handle('jying-clouds',(_e,id)=>getJyingProvider().clouds(id));ipcMain.handle('jying-torrent',(_e,seed)=>getJyingProvider().torrent(seed));ipcMain.handle('jying-filters',()=>getJyingProvider().filters());ipcMain.handle('jying-monitor-state',()=>jyingMonitor.state());ipcMain.handle('jying-monitor-save',(_e,value)=>{const state=jyingMonitor.update(value || {});syncScanOnlyTasks('jying');return state;});ipcMain.handle('jying-monitor-run',()=>jyingMonitor.run(true));ipcMain.handle('jying-monitor-stop',()=>jyingMonitor.stop());
ipcMain.handle('jying-export',async()=>{if(jyingExportRunning)throw Error('聚影导出正在进行');const snapshot=jyingMonitor.snapshot();if(!snapshot.rows.length)throw Error('暂无聚影扫描结果，请先检查资源');jyingExportRunning=true;try{const result=await dialog.showSaveDialog(mainWindow,{title:'导出聚影扫描磁力',defaultPath:`聚影扫描磁力-${exportFilenameStamp()}.xlsx`,filters:[{name:'Excel工作簿',extensions:['xlsx']}]});if(result.canceled)return {canceled:true};const rows=snapshot.rows.map(row=>{const stored=getDatabaseResource(resourceDatabase(),String(readConfig().monitorAccountUid || '')+'|'+magnetKey(row.url));return mergeExportRecord(stored?.exportRecord || {},row);});const target=/\.xlsx$/i.test(result.filePath)?result.filePath:result.filePath+'.xlsx';if(jsonStore)await jsonStore.xlsx(target,rows);else fs.writeFileSync(target,scanExportTools().buildXlsx(rows));return {count:rows.length,path:target};}finally{jyingExportRunning=false;}});
ipcMain.handle('open-original', async (_event, raw) => {
  const url = new URL(String(raw || ''));
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('原网页地址无效');
  await shell.openExternal(url.href);
});
ipcMain.handle('site-login-window', () => {
  if (siteLoginWindow && !siteLoginWindow.isDestroyed()) { siteLoginWindow.focus(); return siteLoginResult; }
  const origin = mirrorConfig().current;
  const win = new BrowserWindow({ ...loginWindowSize(1050, 800), title: '登录不太灵', webPreferences: { partition: 'persist:cloudsave', contextIsolation: true, nodeIntegration: false, sandbox: true } });
  siteLoginWindow = win;
  let closing = false;
  const capture = async () => {
    if (win.isDestroyed()) return;
    const url = new URL(win.webContents.getURL());
    if (!SITE_MIRRORS.includes(url.origin)) return;
    const token = normalizeSiteToken(await win.webContents.executeJavaScript("localStorage.getItem('token') || ''"));
    if (token) saveSiteSession(token, url.hostname, await getSiteCookie(url.origin));
  };
  siteLoginResult = new Promise(resolve => {
    win.on('close', event => { if (closing) return; event.preventDefault(); closing = true; capture().catch(() => {}).finally(() => win.destroy()); });
    win.on('closed', () => { siteLoginWindow = null; const saved = loadSiteSession(); resolve({ loggedIn: Boolean(saved.token), host: saved.host }); });
  });
  win.webContents.on('did-finish-load', () => capture().catch(() => {}));
  win.webContents.setWindowOpenHandler(({ url }) => { try { if (SITE_MIRRORS.includes(new URL(url).origin)) win.loadURL(url).catch(() => {}); } catch (_) {} return { action: 'deny' }; });
  win.loadURL(origin + '/').catch(error => { if (!win.isDestroyed()) win.webContents.executeJavaScript('document.body.textContent = ' + JSON.stringify('网站加载失败：' + error.message)).catch(() => {}); });
  return siteLoginResult;
});

ipcMain.handle('export-scan-excel', (_event, enrich) => exportScannedMagnets(enrich !== false));
ipcMain.handle('cancel-scan-export', () => { scanExportCancelled = true; return true; });
ipcMain.handle('site-session', async () => { const saved = loadSiteSession(); return { loggedIn: Boolean(saved.token || saved.cookie || await getSiteCookie()), host: saved.host }; });
ipcMain.handle('save-site-session', async (_event, token, host) => { const origin = `https://${String(host || '')}`; if (!SITE_MIRRORS.includes(origin)) throw new Error('网站会话来源无效'); return saveSiteSession(String(token || ''), String(host || ''), await getSiteCookie(origin)); });
ipcMain.handle('pan-search', (_event, query, page) => fetchPanSearch(String(query || ''), Number(page) || 1));
let sharedPosterCache;ipcMain.handle('poster-data',(_event,url,site)=>{sharedPosterCache ||=new (require('./poster-cache').PosterCache)({root:path.join(app.getPath('userData'),'poster-cache')});return sharedPosterCache.load(String(url || ''),site,mirrorConfig().current);});
ipcMain.handle('get-account', async () => { const cookie = loadCookie(); return cookie ? getAccount(cookie) : {}; });
ipcMain.handle('get-credentials', (_event, provider) => loadCredentials(provider || '115'));
ipcMain.handle('save-credentials', (_event, provider, account, password) => saveCredentials(provider || '115', account, password));
ipcMain.handle('copy-cookie', () => { const cookie = loadCookie(); if (!cookie) throw new Error('本机还没有已保存的 Cookie'); clipboard.writeText(cookie); return true; });
ipcMain.handle('get-monitor-state', () => ({ ...monitorConfig(), running: monitorRunning, nextCheckAt:monitorNextCheckAt?new Date(monitorNextCheckAt).toISOString():'', pendingPlacementCount: pendingOfflinePlacementCount(), ...(monitorRunning && monitorProgressMessage ? { lastMessage: monitorProgressMessage } : {}) }));
ipcMain.handle('clear-monitor-logs', () => saveMonitor({ logs: [] }));
ipcMain.handle('monitor-log-text', () => completeMonitorLogText());
ipcMain.handle('retry-coverage-review', async (_event,url) => {
  const config=readConfig(),uid=String(config.monitorAccountUid || loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || '');
  const review=(config.monitorCoverageReview || []).find(row=>row.url===url && (!row.uid || row.uid===uid));
  if(!review)throw new Error('当前账户没有这条待检查记录');
  if(monitorRunning || guanyingMonitor.running)throw new Error('扫描正在进行，请等待本轮完成后重新检查');
  const database=resourceDatabase(),resource=getDatabaseResource(database, `${uid}|${magnetKey(url)}`);
  if(resource){delete resource.fileInspectionAt;delete resource.fileInspectionSession;writeResourceDatabase(database);}
  metadataPermission={signature:'',until:0,message:''};
  const detail=await fetchMovieDetail(review.movieId);
  await inspectTelevisionFiles({id:review.movieId,title:review.movieTitle},detail,monitorConfig().filters);
  const latest=readConfig();delete latest.monitorScan;writeConfig(latest);
  return monitorConfig();
});
ipcMain.handle('set-monitor', (_event, options) => {
  const current = monitorConfig();
  const rawFilters = options?.filters && typeof options.filters === 'object' ? options.filters : current.filters;
  const filters = {
    genres: Array.isArray(rawFilters.genres) ? rawFilters.genres.map(String).filter(Boolean).slice(0, 30) : [],
    countries: Array.isArray(rawFilters.countries) ? rawFilters.countries.map(String).filter(Boolean).slice(0, 30) : [],
    years: Array.isArray(rawFilters.years) ? rawFilters.years.map(String).filter(Boolean).slice(0, 30) : [],
    qualities: Array.isArray(rawFilters.qualities) ? rawFilters.qualities.map(String).filter(Boolean).slice(0, 30) : [],
    tags: Array.isArray(rawFilters.tags) ? rawFilters.tags.map(String).filter(Boolean).slice(0, 30) : [],
    sort: String(rawFilters.sort || '更新时间'),
    scoreRange: String(rawFilters.scoreRange || ''),
    onlyImdb: Boolean(rawFilters.onlyImdb),
    compareSize: rawFilters.compareSize !== false,saveModes:require('./monitor-size-ranges').saveModes(rawFilters.saveModes),
    onlyCloud: Boolean(rawFilters.onlyCloud), sizeRanges:require('./monitor-size-ranges').normalizeSizeRanges(rawFilters),minSizeGB: Number(rawFilters.minSizeGB) || 0, maxSizeGB: Number(rawFilters.maxSizeGB) || 0, withinDays: Math.max(0, Number(rawFilters.withinDays) || 0), dateMode:['range','minutes'].includes(rawFilters.dateMode)?rawFilters.dateMode:'recent', withinMinutes:rawFilters.dateMode==='minutes'?require('./monitor-time').minutes(rawFilters.withinMinutes):Number(rawFilters.withinMinutes)||60, startDate: String(rawFilters.startDate || ''), endDate: String(rawFilters.endDate || ''), maxItems: normalizeMonitorLimit(rawFilters.maxItems)
  };
  validateUpdateTimeFilter(filters);
  if (filters.minSizeGB < 0 || filters.maxSizeGB < 0 || (filters.maxSizeGB && filters.minSizeGB > filters.maxSizeGB)) throw new Error('资源大小范围无效，最大值不能小于最小值');
  const changedFilters=monitorScanSignature(filters)!==monitorScanSignature(current.filters);
  const next = saveMonitor({ ...(!current.enabled && options?.enabled?{nextFilterProbeAt:''}:{}), ...(changedFilters?{filterBlockedSignature:'',nextFilterProbeAt:'',filterBlockedProbe:null,nextRetryAt:'',failureStreak:0}:{}), enabled: Boolean(options?.enabled),scanOnly:options?.scanOnly==null?current.scanOnly:Boolean(options.scanOnly),autoSubmit:(options?.scanOnly??current.scanOnly)?false:options?.autoSubmit==null?current.autoSubmit:Boolean(options.autoSubmit), intervalMinutes: Math.max(5, Math.min(1440, Number(options?.intervalMinutes) || current.intervalMinutes)), filters });
  syncScanOnlyTasks('butailing');if(current.enabled!==next.enabled || current.intervalMinutes!==next.intervalMinutes || !monitorTimer)scheduleMonitor();
  scheduleFilterProbe();
  if (next.enabled && !options?.deferRun) setTimeout(() => runMonitor(false), 250);
  return next;
});
ipcMain.handle('run-monitor', () => runMonitor(true));
ipcMain.handle('stop-monitor',()=>{monitorStopRequested=true;return {...monitorConfig(),running:monitorRunning};});
ipcMain.handle('resource-rates',(_event,value)=>{const c=readConfig();if(value){for(const [site,key] of [['butailing','resourceRequestIntervalMs'],['guanying','guanyingRequestIntervalMs'],['btbtla','btbtlaRequestIntervalMs'],['jying','jyingRequestIntervalMs'],['qmp4','qmp4RequestIntervalMs']])if(value[site]!=null)c[key]=Math.max(1000,Math.min(60000,Math.round(Number(value[site])||3000)));writeConfig(c);}return {butailing:c.resourceRequestIntervalMs || 3000,guanying:c.guanyingRequestIntervalMs || 3000,btbtla:c.btbtlaRequestIntervalMs || 3000,jying:c.jyingRequestIntervalMs || 3000,qmp4:c.qmp4RequestIntervalMs || 3000};});
ipcMain.handle('validate-cookie', async (_event, raw) => {
  const cookie = normalizeCookie(raw);
  const account = await getAccount(cookie);
  saveCookie(cookie);
  return account;
});
ipcMain.handle('login-window', async () => {
  const win = new BrowserWindow({ ...loginWindowSize(1100, 800), title: '登录 115', webPreferences: { partition: 'persist:cloudsave-115', contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await win.loadURL('https://115.com/');
  return new Promise(resolve => {
    win.on('closed', async () => {
      const cookies = await session.fromPartition('persist:cloudsave-115').cookies.get({});
      const wanted = new Set(['UID', 'CID', 'SEID', 'KID']);
      const values = new Map();
      for (const cookie of cookies) if (wanted.has(cookie.name) && /(^|\.)115\.com$/.test(cookie.domain.replace(/^\./, ''))) values.set(cookie.name, cookie.value);
      const raw = [...values].map(([key, value]) => `${key}=${value}`).join('; ');
      if (!raw) return resolve({});
      try { const account = await getAccount(raw); saveCookie(raw); resolve(account); } catch (error) { resolve({ error: error.message }); }
    });
  });
});
ipcMain.handle('folders', (_event, cid) => getFolders(loadCookie(), cid || '0'));
ipcMain.handle('set-folder', async (_event, folder) => { const cookie = loadCookie(); const account = await getAccount(cookie); const validated = await validateSaveFolder(cookie, folder || {}, account.uid); if (cookie !== loadCookie()) throw new Error('115账户已更换，请重新选择目录'); const config = readConfig(); config.folder = validated; writeConfig(config); return validated; });
function submitConfiguredMagnet(url, context = {}) {
  let target;
  try { target = defaultSaveFolder(); }
  catch (error) { recordSubmitHistory(url, 'failed', error.message, readConfig().folder?.cid ?? '', { ...context, folderName: readConfig().folder?.name || '', uid: (loadCookie().match(/(?:^|;\s*)UID=(\d+)/) || [])[1] || '' }); throw error; }
  return submitMagnet(loadCookie(), String(url), target.cid, target.name, context);
}
ipcMain.handle('offline-episode-size',async(_e,value)=>{if(value!==undefined){const c=readConfig();c.offlineEpisodeSize=require('./offline-episode-size').normalize(value);writeConfig(c);if(jsonStore)await jsonStore.flush();}return require('./offline-episode-size').normalize(readConfig().offlineEpisodeSize||{});});
ipcMain.handle('submit-magnet', (_event, url, context) => {
  if (!/^(magnet:\?|ed2k:\/\/)/i.test(String(url || ''))) throw new Error('不是有效的磁力或电驴链接');
  const metadata = { title: String(context?.title || '').slice(0, 500), movieId: String(context?.movieId || ''), mode: ['movie','tv'].includes(context?.mode)?context.mode:'', size: String(context?.size || ''), seedId:String(context?.seedId || context?.raw?.id || ''),raw:context?.raw,movieInfo:context?.movieInfo };
  const coverage = metadata.mode === 'tv' ? episodeCoverage(metadata.title) : null;
  const row = coverage && metadata.movieId ? coverageCandidate({url,size:metadata.size,title:metadata.title}, {id:metadata.movieId},coverage) : {};
  const selectionKey = row.selectionKey || (metadata.mode !== 'tv' ? metadata.movieId : '');
  return submitConfiguredMagnet(url, { ...metadata, source: 'manual', selectionKey, episodeKeys:row.episodeKeys || [],episodeSizeGB:row.episodeSizeGB || 0 }).then(publicSubmissionFeedback);
});
function libraryScanOnly(site){const c=readConfig();return site==='butailing'?Boolean(c.monitor?.scanOnly):Boolean(c[site+'Monitor']?.options?.scanOnly);}
function syncScanOnlyTasks(site){if(libraryScanOnly(site))for(const task of share115Monitor?.data.tasks||[])if(task.site===site)share115Monitor.stop(task.id);share115Monitor?.arm();}
function libraryShareEnabled(site){if(libraryScanOnly(site))return false;const c=readConfig();if(site==='custom')return true;return c.library115?.[site]?.share ?? (c.automation115?.share!==false);}
function libraryMagnetEnabled(site){const c=readConfig();return c.library115?.[site]?.magnet ?? (c.automation115?.magnet!==false);}
ipcMain.handle('library-115',async(_e,site,value)=>{if(!['butailing','guanying','btbtla','jying','qmp4','custom'].includes(site))throw Error('资源库无效');if(value!==undefined){if(typeof value.magnet!=='boolean'||typeof value.share!=='boolean')throw Error('开关值无效');const c=readConfig();c.library115||={};c.library115[site]={magnet:value.magnet,share:value.share};writeConfig(c);if(jsonStore)await jsonStore.flush();if(!value.share)for(const task of share115Monitor?.data.tasks||[])if(task.site===site)share115Monitor.stop(task.id);share115Monitor?.arm();if(site!=='custom'){if(site==='butailing'){if(!value.magnet)monitorStopRequested=true;saveMonitor({enabled:value.magnet,...(value.magnet?{autoSubmit:true}:{})});scheduleMonitor();}else{const monitor=({guanying:guanyingMonitor,btbtla:btbtlaMonitor,jying:jyingMonitor,qmp4:qmp4Monitor})[site];if(!value.magnet)monitor.stop();monitor.save({enabled:value.magnet,options:{...monitor.state().options,...(value.magnet?{autoSubmit:true}:{})}});monitor.schedule();}}}const state=site==='butailing'?monitorConfig():site==='custom'?null:({guanying:guanyingMonitor,btbtla:btbtlaMonitor,jying:jyingMonitor,qmp4:qmp4Monitor})[site].state();return {magnet:libraryMagnetEnabled(site)&&Boolean(state?.enabled)&&(state.options?state.options.autoSubmit:state.autoSubmit),share:libraryShareEnabled(site)};});
function automation115(){const value=readConfig().automation115||{};return {share:value.share!==false,magnet:value.magnet!==false};}
ipcMain.handle('automation-115',async(_e,value)=>{if(value!==undefined){if(typeof value.share!=='boolean'||typeof value.magnet!=='boolean')throw Error('开关值无效');const c=readConfig();c.automation115={share:value.share,magnet:value.magnet};writeConfig(c);if(jsonStore)await jsonStore.flush();if(!value.share)share115Monitor?.stop();share115Monitor?.arm();if(!value.magnet){monitorStopRequested=true;guanyingMonitor.stop();btbtlaMonitor.stop();jyingMonitor.stop();qmp4Monitor.stop();}}return automation115();});
function share115Instance(){if(!share115Monitor)throw Error(share115SetupError||'115分享监控尚未初始化');return share115Monitor;}
let customShareParser=null;
async function share115Adapter(site,task={}){
 if(site==='custom'){
  const custom=new (require('./custom-share115-provider').CustomShare115Provider)({html:async(url,base)=>{const origin=new URL(base).origin;if(new URL(url).origin!==origin)throw Error('自定义网站只读取输入地址所属站点的页面');const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok||new URL(r.url).origin!==origin)throw Error('自定义网站访问失败或跳转到其他站点');return r.text();},parse:(html,kind,url,extract)=>{customShareParser ||= {BrowserWindow,window:null};return require('./site-reader').parseInWindow(customShareParser,html,kind,url,extract);}});
  return {filters:{...require('./share115-filters').normalize(task),websiteUrl:task.websiteUrl,requiredFormats:task.requiredFormats,excludedFormats:task.excludedFormats,requireAllFormats:task.requireAllFormats},categories:['custom'],catalog:(c,p,a)=>custom.catalog(c,p,a,task),detail:(m,a)=>custom.detail(m,a,task)};
 }
 const monitor=site==='guanying'?guanyingMonitor:site==='btbtla'?btbtlaMonitor:site==='jying'?jyingMonitor:site==='qmp4'?qmp4Monitor:null;
 const categories=['mv','tv'];if(!categories.length)throw Error('请选择该网站的监控分类');
 const provider=site==='guanying'?getGuanyingProvider():site==='btbtla'?getBtbtlaProvider():site==='jying'?getJyingProvider():site==='qmp4'?getQmp4Provider():null;
 return {filters:{...require('./share115-filters').normalize(task),requiredFormats:task.requiredFormats,excludedFormats:task.excludedFormats,requireAllFormats:task.requireAllFormats},categories,
  catalog:async(category,page,active)=>{active();if(provider)return provider.catalog(category,page,{sort:'uptime',onlyCloud:!task.magnetEnabled,res:site==='jying'?'':task.destination==='guangya'?'':'网盘'},{});const batch=await fetchCloudCatalog(category==='mv'?'movie':'tv',page,{strictCatalog:true,onlyCloud:!task.magnetEnabled,sort:'更新时间',probeFresh:true});return {...batch,hasNext:batch.items.length>0&&page<Math.ceil(batch.total/Math.max(1,batch.limit))};},
  detail:async(movie,active)=>{active();const raw=provider?(provider.summary&&!task.magnetEnabled?await provider.summary(movie.id,{fresh:false}):await provider.detail(movie.id,{fresh:true})):await fetchMovieDetail(movie.id);active();let clouds=normalizeCloudDetail(raw).clouds;if(provider?.clouds&&Number(raw.wp_num)!==0)clouds=await provider.clouds(movie.id,{fresh:false,destination:task.destination||'115'});active();return {raw,clouds,seeds:normalizeCloudDetail(raw).seeds};}
 };
}
function shared115Backend(){
 const shareProvider=new (require('./share115-provider').Share115Provider)({request:apiRequest,check:check115,wait:waitResource});
 return {cookie:loadCookie,account:getAccount,validateFolder:validateSaveFolder,currentUid:async()=>String((await getAccount(loadCookie())).uid),
  parseShare:(url,code,row)=>{if(/^magnet:\?/i.test(url)){const hash=String(url).match(/btih:([a-z0-9]{32,40})/i)?.[1];return hash?{shareCode:'magnet:'+hash.toLowerCase(),url,magnet:true,row}:null;}return require('./share115-provider').parseShare(url,code);},
  provider:{list:(share,cookie,active)=>share.magnet?Promise.resolve([{id:magnetKey(share.url),name:share.row?.title||'',bytes:NaN}]):shareProvider.list(share,cookie,active),
   inspect:(share,files,cookie,active)=>{if(share.magnet)throw Error('磁力没有可核对的完整文件清单，未通过视频格式筛选');return shareProvider.inspect(share,files,cookie,active);},
   size:(share,files,cookie,active)=>{if(share.magnet)throw Error('磁力大小未知，未通过大小筛选');return shareProvider.size(share,files,cookie,active);},
   receive:async(share,ids,cid,cookie)=>{if(!share.magnet)return shareProvider.receive(share,ids,cid,cookie);const account=await getAccount(cookie);const task=share.row;await submitMagnet(cookie,share.url,cid,task.folderName||'指定目录',{...task,uid:account.uid,source:'auto'});return {taskId:'local-magnet-accepted'};}
  }
 };
}
function setupShare115Monitor(){
 try{const file=localCacheFile('share115-monitor.json'),backend115=shared115Backend();share115Monitor=new (require('./share115-monitor').Share115Monitor)({
  backend:task=>task.destination==='guangya'?guangyaModule.backend:task.destination&&task.destination!=='115'?multiCloudModule?.backend(task.destination):backend115,enabled:()=>true,siteEnabled:libraryShareEnabled,read:()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null,write:async data=>{writeLocalCache('share115-monitor.json',data);if(jsonStore)await jsonStore.flush();},cookie:loadCookie,account:getAccount,validateFolder:validateSaveFolder,currentUid:async()=>String((await getAccount(loadCookie())).uid),adapter:share115Adapter,
  provider:new (require('./share115-provider').Share115Provider)({request:apiRequest,check:check115,wait:waitResource}),wait:waitResource,stopped:()=>shuttingDown,log:(message,level,website)=>appendMonitorLog(message,level,'来源网站：'+website,'share115'),publish:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('share115-state-updated',state);}
 });share115Monitor.arm();}catch(error){share115SetupError='115分享监控数据无法初始化，未覆盖原数据：'+error.message;appendMonitorLog(share115SetupError,'warning','','115');}
}
ipcMain.handle('share115-state',()=>share115Instance().state());
ipcMain.handle('share115-save',(_e,value)=>share115Instance().save(value));
ipcMain.handle('share115-remove',(_e,id)=>share115Instance().remove(id));
ipcMain.handle('share115-run',(_e,id)=>share115Instance().run(id));
ipcMain.handle('share115-stop',(_e,id)=>share115Instance().stop(id));
ipcMain.handle('share115-resolve',(_e,id,action)=>share115Instance().resolve(id,action));

function cloudDownloadProgressState(){const uid=loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || '',value=cloudDownloadCache.data.accounts[uid] || {},prefs=cloudSyncPreferences();return {uid,...prefs,syncedAt:value.syncedAt || 0,count:value.count || 0,cachedCount:(value.currentKeys||Object.keys(value.tasks||{})).length,readCount:value.readCount??value.count??0,pageReads:value.pageReads||0,fetchedCount:value.fetchedCount??value.readCount??0,statusChecked:value.statusChecked||0,statusErrors:value.statusErrors||0,checkpoint:value.checkpoint||0,fullSyncedAt:value.fullSyncedAt||0,fullReadCount:value.fullReadCount||0,lastSyncMode:value.lastSyncMode||'incremental',rangeStart:value.rangeStart||0,added:value.added || 0,changed:value.changed || 0,progress:cloudDownloadCache.progress,running:Boolean(cloudDownloadCache.running),nextSyncAt:prefs.enabled?cloudDownloadCache.nextSyncAt(uid,prefs.intervalMinutes*60000):0};}
function pushCloudDownloadProgress(progress){if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.webContents.send('cloud-download-progress',{...cloudDownloadProgressState(),running:progress.running});if(!progress.running)notifySubmitHistoryUpdated();}}
function cloudDownloadState(){const uid=loadCookie().match(/(?:^|;\s*)UID=(\d+)/)?.[1] || '',value=cloudDownloadCache.data.accounts[uid];const tasks=cloudDownloadCache.snapshot(uid),counts=value?.counts || tasks.reduce((sum,row)=>{sum[row.state]=(sum[row.state] || 0)+1;return sum;},{downloading:0,failed:0,completed:0,unknown:0});return {...cloudDownloadProgressState(),uid,tasks,counts,...cloudSyncPreferences(),syncedAt:value?.syncedAt || 0,count:value?.count || 0,added:value?.added || 0,changed:value?.changed || 0,running:Boolean(cloudDownloadCache.running)};}
ipcMain.handle('cloud-download-state',cloudDownloadState);
ipcMain.handle('cloud-download-settings',(_event,value)=>{const config=readConfig();const hours=Number(value.lookbackHours??config.cloudDownloadSync?.lookbackHours??24);if(![24,48,168].includes(hours))throw new Error('同步范围无效');config.cloudDownloadSync={...require('./cloud-sync-schedule').syncPreferences(value),lookbackHours:hours};writeConfig(config);cloudSyncSchedule.arm();pushCloudDownloadProgress(cloudDownloadCache.progress);return cloudDownloadState();});
ipcMain.handle('sync-cloud-downloads',async(_event,options)=>{if(options!==undefined&&(!options||typeof options!=='object'||!['incremental','full'].includes(options.mode)))throw new Error('同步模式无效');await cloudDownloadCache.sync(true,{full:options?.mode==='full'});await repairCachedOfflinePlacements();cloudSyncSchedule.arm();notifySubmitHistoryUpdated();return cloudDownloadState();});
ipcMain.handle('submit-history', () => submitHistory().slice().reverse().map(row => {
  const resource = getDatabaseResource(resourceDatabase(), `${row.uid}|${magnetKey(row.url)}`);
  const record = resource?.exportRecord || row.exportRecord || {}, media = record.media || {};
  // Send display fields only. Raw website responses and torrent trees remain in the database/export path.
  return { uid:row.uid,cloudKey:magnetKey(row.url),id: row.id, time: row.time, url: row.url, status: row.status, source: row.source, title: row.title,
    website:row.website || (String(row.movieId || resource?.movieId || '').startsWith('gy:')?'guanying':'butailing'), folderName: row.folderName, size: row.size, episodeKeys: row.episodeKeys, cloudState:cloudDownloadCache.state(row.uid,row.url),
    message: submissionDisplayFeedback(row), episodeSizes: resource?.episodeFiles?.sizes || resource?.episodeSizes || row.episodeSizes,
    sizeSource: resource?.episodeFiles?.keys?.length ? '种子文件清单' : row.sizeSource,
    exportRecord: { releaseDate: record.releaseDate, genre: record.genre, country: record.country, publishDate: record.publishDate,
      media: Object.fromEntries(['filename','duration','resolution','frameRate','video','audio'].map(key => [key, media[key]])) } };
}));
ipcMain.handle('export-submit-history-excel', async (_event, options) => {
  const allRows = JSON.parse(JSON.stringify(submitHistory())).reverse();
  const filtered = options !== undefined;
  let rows = allRows;
  if (filtered) {
    if (!options || !Array.isArray(options.keys)) throw new Error('筛选导出参数无效，请刷新记录后重试');
    rows = filterHistoryExportRows(allRows, options.keys, row => `${row.uid}|${magnetKey(row.url)}`);
  }
  if (!rows.length) throw new Error('暂无历史提交记录');
  const choice = await dialog.showSaveDialog(mainWindow, { title: filtered ? '导出筛选后的提交记录' : '导出全部历史提交记录', defaultPath: `${filtered ? '离线筛选记录' : '离线提交记录'}-${exportFilenameStamp()}.xlsx`, filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }] });
  if (choice.canceled || !choice.filePath) return { cancelled: true };
  const sources = { auto: '自动监控不太灵', manual: '手动提交', batch: '批量离线' };
  const statuses = { success: '已确认保存到目录', pending: '已加入离线任务，等待完成', duplicate: '已提交自动跳过', failed: '失败', uncertain: '提交待确认', placement_failed: '保存目录异常', unverified: '下载完成，位置未核实' };
  const tools=scanExportTools(), cache=new Map(), movies=new Map(), reasons=new Set(); let firstMissing=true, missing=0;
  for(const row of rows){
    const identity=`${row.uid}|${magnetKey(row.url)}`;let resource=getDatabaseResource(resourceDatabase(), identity);
    if(!resource){const database=resourceDatabase();mergeDatabaseResource(database,row,row.status);writeResourceDatabase(database);resource=getDatabaseResource(database, identity);}
    if(!cache.has(identity)){
      let data=mergeExportRecord(resource?.exportRecord || row.exportRecord || {},{url:row.url,title:row.title,movieId:row.movieId,size:row.size||resource?.size,sizeGB:row.sizeGB||resource?.sizeGB,movieTitle:row.movieTitle||normalizeMovie(resource?.movieInfo||{}).title});
      exportProgress(`历史信息 ${cache.size+1}：优先读取本地 ${row.title || row.url}`);
      const incomplete=tools.MEDIA_KEYS.some(field=>!data.media?.[field]) || !data.releaseDate || !data.genre || !data.country || !data.movieTitle;
      if(incomplete && resource){const result=await hydrateHistoryResource(row.uid,magnetKey(row.url),firstMissing,movies);firstMissing=false;data=result.row;if(result.reason)reasons.add(result.reason);}
      cache.set(identity,data);
    }
    row.exportRecord=cache.get(identity);if(tools.MEDIA_KEYS.some(field=>!row.exportRecord.media?.[field]))missing++;
  }
  const headers=[...tools.HEADERS];
  const values=rows.map(item=>tools.rowValues(item.exportRecord));
  const widths=[30,18,42,48,70,18,28,18,36,55,24,28];
  const target=/\.xlsx$/i.test(choice.filePath)?choice.filePath:choice.filePath+'.xlsx';
  const sheetName=filtered?'筛选提交记录':'全部提交记录';
  if(jsonStore)await jsonStore.xlsx(target,values,{headers,widths,name:sheetName});else fs.writeFileSync(target,tools.buildTableXlsx(headers,values,widths,sheetName));
  appendMonitorLog(`已导出${filtered?'筛选':'全部'} ${rows.length} 条历史提交记录`,'info',`${target} · ${missing} 条媒体信息不完整 · ${[...reasons].join('；')}`);
  return {path:target,count:rows.length,missing,reasons:[...reasons]};
});
ipcMain.handle('copy-submit-history', () => { const rows=submitHistory();if(!rows.length)throw new Error('暂无历史提交记录');const sources={auto:'自动监控不太灵',manual:'手动提交',batch:'批量离线'},statuses={success:'已确认保存到目录',pending:'已加入离线任务，等待完成',duplicate:'已提交自动跳过',failed:'失败',uncertain:'提交待确认',placement_failed:'保存目录异常',unverified:'下载完成，位置未核实'};clipboard.writeText(['时间\t来源\t状态\t资源标题\t保存目录\t磁力链接\t反馈',...rows.map(item=>[item.time,item.source==='auto' && (item.website==='qmp4' || String(item.movieId || '').startsWith('qm5:')) ? '自动监控七味' : item.source==='auto' && (item.website==='jying' || String(item.movieId || '').startsWith('jy4:')) ? '自动监控聚影' : item.source==='auto' && (item.website==='btbtla' || String(item.movieId || '').startsWith('bt3:')) ? '自动监控BT影视' : item.source==='auto' && (item.website==='guanying' || String(item.movieId || '').startsWith('gy:')) ? '自动监控观影' : sources[item.source] || '历史记录',statuses[item.status] || item.status,item.title || '',item.folderName || '',item.url,publicSubmissionFeedback(item.message)].map(value=>String(value || '').replace(/[\r\n\t]+/g,' ')).join('\t'))].join('\n'));return rows.length;});
ipcMain.handle('save-filtered-history-links', async (_event, rawLinks) => {
  const { prepareLinks, asText } = require('./filtered-link-export');
  const links = prepareLinks(rawLinks);
  const choice = await dialog.showSaveDialog(mainWindow, { title: '保存筛选链接为文本', defaultPath: `离线筛选链接-${exportFilenameStamp()}.txt`, filters: [{ name: '文本文件', extensions: ['txt'] }] });
  if (choice.canceled || !choice.filePath) return { cancelled: true };
  const target = /\.txt$/i.test(choice.filePath) ? choice.filePath : `${choice.filePath}.txt`;
  fs.writeFileSync(target, asText(links), 'utf8');
  try { appendMonitorLog(`已保存 ${links.length} 条筛选历史链接`, 'info', target); } catch {}
  return { path: target, count: links.length };
});
let batchSubmitRunning = false;
ipcMain.handle('batch-submit-magnets', async (_event, raw) => {
  if (batchSubmitRunning) throw new Error('批量离线正在执行，请等待当前批次完成');
  const batchMode=raw&&typeof raw==='object'?raw.mode:'',input=raw&&typeof raw==='object'?raw.raw:raw;
  const unique = new Map();
  for (const url of String(input || '').split(/\r?\n|[，,\s]+/).map(item => item.trim()).filter(item => /^(magnet:\?|ed2k:\/\/)/i.test(item))) if (!unique.has(magnetKey(url))) unique.set(magnetKey(url), url);
  const urls = [...unique.values()]; if (!urls.length) throw new Error('没有有效的磁力或电驴链接');
  batchSubmitRunning = true; const results = [];
  try {
    for (const url of urls) {
      try { const message = await submitConfiguredMagnet(url, { source: 'batch',mode:['movie','tv'].includes(batchMode)?batchMode:'' }); const status = /^已确认保存至/.test(message) ? 'success' : /曾经添加过/.test(message) ? 'duplicate' : /位于其他目录/.test(message) ? 'placement_failed' : 'pending'; results.push({ url, status, message }); }
      catch (error) { results.push({ url, status: error.uncertain ? 'uncertain' : 'failed', message: error.message }); }
      if (url !== urls[urls.length - 1]) await waitResource(1000);
    }
    return results.map(row=>({...row,message:publicSubmissionFeedback(row.message)}));
  } finally { batchSubmitRunning = false; }
});
ipcMain.handle('logout', () => { const config = readConfig(); delete config.cookie; delete config.folder; writeConfig(config); return true; });


if (!ownsApplicationLock) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(() => { if (portableStorage) { const config = readConfig(); const migration = portableStorage.migrate(config); if (migration.changed) writeConfig(config); if (migration.failed) appendMonitorLog('部分旧登录凭据无法迁移，请在原电脑首次运行便携版后再搬移', 'warning'); } pan123Monitor=require('./pan123-main')({app,BrowserWindow,ipcMain,session,read:()=>readLocalCache('pan123-monitor.json'),write:data=>{const file=localCacheFile('pan123-monitor.json');fs.mkdirSync(path.dirname(file),{recursive:true});const fd=fs.openSync(file+'.tmp','w');try{fs.writeFileSync(fd,JSON.stringify(data),'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(file+'.tmp',file);},readConfig,writeConfig,encrypt:encryptSecret,decrypt:decryptSecret,notify:(channel,value)=>{for(const w of BrowserWindow.getAllWindows())if(!w.isDestroyed())w.webContents.send(channel,value);},log:appendMonitorLog,windowSize:loginWindowSize}); multiCloudModule=require('./multi-cloud-main')({BrowserWindow,ipcMain,session,readConfig,writeConfig,encrypt:encryptSecret,decrypt:decryptSecret,pan123:()=>pan123Monitor});setupShare115Monitor();for(const monitor of [guanyingMonitor,btbtlaMonitor,jyingMonitor,qmp4Monitor])monitor.d.magnetEnabled=()=>libraryMagnetEnabled(monitor.website); guangyaModule=require('./guangya-main')({app,BrowserWindow,ipcMain,session,readConfig,writeConfig,encrypt:encryptSecret,decrypt:decryptSecret,parse:parse115Json,flush:async()=>{if(jsonStore)await jsonStore.flush();},stopped:()=>shuttingDown,log:(message,level)=>appendMonitorLog(message,level,'','guangya'),windowSize:loginWindowSize}); createWindow(); lifecycleTimers.push(setTimeout(syncCloudDownloads,15000)); lifecycleTimers.push(setInterval(syncCloudDownloads,60000));lifecycleTimers.push(setTimeout(repairCachedOfflinePlacements,20000));lifecycleTimers.push(setInterval(repairCachedOfflinePlacements,120000)); scheduleMonitor();qmp4Monitor.schedule();if(qmp4Monitor.state().enabled)lifecycleTimers.push(setTimeout(()=>qmp4Monitor.run(false),150000));jyingMonitor.schedule();if(jyingMonitor.state().enabled)lifecycleTimers.push(setTimeout(()=>jyingMonitor.run(false),120000));btbtlaMonitor.schedule();if(btbtlaMonitor.state().enabled)lifecycleTimers.push(setTimeout(()=>btbtlaMonitor.run(false),90000)); guanyingMonitor.schedule(); if(guanyingMonitor.state().enabled)lifecycleTimers.push(setTimeout(()=>guanyingMonitor.run(false),60000)); if (monitorConfig().enabled) lifecycleTimers.push(setTimeout(() => runMonitor(false), 30000)); });
}
let quittingAfterFlush = false, quitFlushInFlight = false;
if (jsonStore) app.on('before-quit', event => {
  if (quittingAfterFlush) return; event.preventDefault();
  if (quitFlushInFlight) return;
  quitFlushInFlight = true;
  (async () => {
  shuttingDown = true;if(customShareParser?.window&&!customShareParser.window.isDestroyed())customShareParser.window.destroy(); multiCloudModule?.close();guangyaModule?.close();pan123Monitor?.close();share115Monitor?.close(); cloudSyncSchedule.close(); cloudSubmitSync.close(); browseCache.close(); scanExportCancelled = true; guanyingMonitor.close();btbtlaMonitor.close();btbtlaProvider?.close();jyingMonitor.close();jyingProvider?.close();qmp4Monitor.close();qmp4Provider?.close();haisouView?.webContents.close(); guanyingProvider?.close();
  if (monitorTimer) clearInterval(monitorTimer);
  if(filterProbeTimer)clearTimeout(filterProbeTimer);
  for (const timer of lifecycleTimers) { clearInterval(timer); clearTimeout(timer); }
  if (monitorPushTimer) { clearTimeout(monitorPushTimer); monitorPushTimer = null; }
    await Promise.allSettled([offlineOperationQueue, metadataQueue, cloudDownloadCache.running, cloudSubmitSync.running, pan123Monitor?.running,share115Monitor?.running,guangyaModule?.running, guanyingSessionManager?.close()]);
    const quitWait = await waitForQuitIdle([
      ['不太灵监控', () => monitorRunning], ['观影监控', () => guanyingMonitor.running], ['BT影视监控', () => btbtlaMonitor.running],
      ['聚影监控', () => jyingMonitor.running], ['七味监控', () => qmp4Monitor.running],
      ['观影导出', () => guanyingExportRunning], ['BT影视导出', () => btbtlaExportRunning], ['聚影导出', () => jyingExportRunning], ['七味导出', () => qmp4ExportRunning],
      ['保存位置核查', () => placementCheckRunning], ['批量离线提交', () => batchSubmitRunning], ['扫描结果导出', () => scanExportRunning],
    ], { wait: waitResource });
    if (quitWait.timedOut) appendMonitorLog('退出等待超过 20 秒，未结束的任务已放弃等待，按已保存的数据退出', 'warning', quitWait.pending.join('、'));
    await jsonStore.close();
  })().then(() => { quittingAfterFlush = true; app.quit(); }).catch(error => { quitFlushInFlight = false; dialog.showErrorBox('数据保存失败，尚未退出', error.message + '\n请检查磁盘空间后重试，避免丢失记录。'); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });


let haisouView;ipcMain.handle('haisou-view',(_event,value={})=>{if(!mainWindow||mainWindow.isDestroyed())return;if(!value.visible){haisouView?.setVisible(false);return;}if(!haisouView){require('./remote-page').configureRemotePageSession(session.fromPartition('persist:cloudsave-haisou'));haisouView=new WebContentsView({webPreferences:{partition:'persist:cloudsave-haisou',contextIsolation:true,nodeIntegration:false,sandbox:true}});mainWindow.contentView.addChildView(haisouView);haisouView.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});haisouView.webContents.loadURL('https://haisou.cc/').catch(e=>appendMonitorLog('海搜页面加载失败','warning',e.message,'haiso'));}const zoom=mainWindow.webContents.getZoomFactor(),bounds=mainWindow.getContentBounds(),rect=value.rect || {};const x=Math.max(0,Math.round((Number(rect.x)||0)*zoom)),y=Math.max(0,Math.round((Number(rect.y)||0)*zoom));haisouView.setBounds({x,y,width:Math.max(1,Math.min(bounds.width-x,Math.round((Number(rect.width)||1)*zoom))),height:Math.max(1,Math.min(bounds.height-y,Math.round((Number(rect.height)||1)*zoom)))});haisouView.setVisible(true);if(value.reload)haisouView.webContents.reload();return true;});

let qmp4VerificationWindow;ipcMain.handle('qmp4-verification-window',async()=>{if(qmp4VerificationWindow&&!qmp4VerificationWindow.isDestroyed()){qmp4VerificationWindow.focus();return qmp4VerificationWindow._result;}require('./remote-page').configureRemotePageSession(session.fromPartition('persist:cloudsave-qmp4'),{host:'www.qmp4.com',preferNative:true});const win=new BrowserWindow({...loginWindowSize(1050,800),title:'七味网站验证（完成后关闭窗口）',webPreferences:{partition:'persist:cloudsave-qmp4',nodeIntegration:false,contextIsolation:true,sandbox:true}});qmp4VerificationWindow=win;win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('https://www.qmp4.com/'))event.preventDefault();});win._result=new Promise(resolve=>win.on('closed',()=>{qmp4VerificationWindow=null;resolve({closed:true});}));win.loadURL(getQmp4Provider().verificationUrl || 'https://www.qmp4.com/').catch(e=>appendMonitorLog('七味验证窗口加载失败','warning',e.message,'qmp4'));return win._result;});

function detailSiteProvider(site){if(site==='btbtla')return getBtbtlaProvider();if(site==='jying')return getJyingProvider();if(site==='qmp4')return getQmp4Provider();throw Error('资源网站无效');}
ipcMain.handle('site-detail-summary',async(_event,site,id,fresh)=>{const provider=detailSiteProvider(site);return normalizeMovie(await (provider.summary?provider.summary(id,{fresh:Boolean(fresh)}):provider.detail(id,{fresh:Boolean(fresh)})));});
ipcMain.handle('site-detail-resources',async(_event,site,id,kind,page=1,fresh=false)=>{if(!['magnet','cloud'].includes(kind))throw Error('资源类型无效');const provider=detailSiteProvider(site);let rows=[],hasMore=false;if(site==='jying'){let result;for(let step=0;step<50;step++){result=await provider.resourcePage(id,Number(page),Boolean(fresh));rows=result.rows.filter(row=>kind==='magnet'?['MagnetLink','ed2k'].includes(row.resource_type):!['MagnetLink','ed2k'].includes(row.resource_type));hasMore=result.hasMore;if(rows.length||!hasMore)break;page=Number(page)+1;}}else if(site==='btbtla'){if(kind==='magnet')rows=await provider.previewSeeds(id,{fresh:Boolean(fresh)});}else{const data=normalizeCloudDetail(await provider.detail(id,{fresh:Boolean(fresh)}));return {rows:kind==='magnet'?data.seeds:data.clouds,hasMore:false,counts:{magnet:data.seeds.length,cloud:data.clouds.length}};}return {rows:rows.map(row=>({title:row.zname || row.title || '',url:row.zlink || row.link || '',size:row.zsize || '',date:row.ezt || '',quality:row.zqxd || '',resourcePage:Number(page),type:row.resource_type_display || row.resource_type || '',code:row.extraction_code || '',locked:row.link_exposed===false,reason:row.link_hidden_reason || '',raw:row})),hasMore,page:Number(page)};});
ipcMain.handle('btbtla-seed-date',async(_event,row)=>{const seed=row.raw || row;const result=await getBtbtlaProvider().read(seed.detailPath,'torrent-date',false);return {date:result.ezt || '',size:result.zsize || '',raw:result};});
ipcMain.handle('site-resolve-resource',async(_event,site,row,id)=>{const provider=detailSiteProvider(site);let resolved;try{resolved=site==='qmp4'?row:await provider.resolve(row.raw || row);}catch(error){if(site!=='jying'||!id||!/凭证|过期|ticket/i.test(error.message))throw error;const fresh=await provider.resourcePage(id,Number(row.resourcePage)||1,true),raw=fresh.rows.find(x=>String(x.id)===String(row.raw?.id));if(!raw)throw error;resolved=await provider.resolve(raw);}return {url:resolved.zlink || resolved.url || '',code:resolved.extraction_code || row.code || '',raw:resolved};});
