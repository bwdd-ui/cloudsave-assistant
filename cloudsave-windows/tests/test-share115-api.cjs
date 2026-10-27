// share115-api.js 是桌面端和手机端共用的一层，所以这里只测它本身，不经过 Electron。
// 传输用假 fetch 注入：真机上的原生桥只要满足 {status,ok,text()} 就能走同一段逻辑。
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const api = require('../share115-api');

// 假传输记录收到的 url/options，用来断言 UA、Cookie 与 redirect 策略；responses 按顺序回放。
function transport(...responses) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}
const json = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });

(async () => {
  // 1. 大整数保精度：115 把未登录的长 ID 写成裸数字，JSON.parse 会静默四舍五入。
  assert.deepEqual(api.parse115Json('{"uid":1234567890123456789,"n":1}'), { uid: '1234567890123456789', n: 1 });
  assert.deepEqual(api.parse115Json('{"a":-12345678901234567890,"b":[9007199254740991,9007199254740992]}'),
    { a: '-12345678901234567890', b: [9007199254740991, '9007199254740992'] });
  // 字符串里的数字与转义引号不能被当成数字令牌处理。
  assert.deepEqual(api.parse115Json('{"note":"123456789012345678901234","q":"he said \\"9007199254740993\\""}'),
    { note: '123456789012345678901234', q: 'he said "9007199254740993"' });
  assert.deepEqual(api.parse115Json('{"f":1.5,"e":1e21,"z":0,"s":"-9007199254740993"}'), { f: 1.5, e: 1e21, z: 0, s: '-9007199254740993' });

  // 2. 登录失效判定
  api.check115({ state: true }); api.check115({ success: true });
  for (const errno of [99, 401, 990001]) assert.throws(() => api.check115({ state: false, errno }), /重新登录/);
  assert.throws(() => api.check115({ state: false, error: '请登录后操作' }), /重新登录/);
  assert.throws(() => api.check115({ state: false, error_msg: '容量不足' }), /容量不足/);
  assert.throws(() => api.check115(undefined), /115 请求失败/);

  // 3. Cookie 归一化：粘贴来源五花八门，缺 UID/CID/SEID 必须当场拒绝
  assert.equal(api.normalizeCookie('cookie: UID=123; CID=abc; SEID=def'), 'UID=123; CID=abc; SEID=def');
  // 值里的 + 是字面量，不能被解码成空格；多余的键按原样大小写保留。
  assert.equal(api.normalizeCookie('UID=123,SEID=a+b,CID=x, MyToken =t1 '), 'UID=123; SEID=a+b; CID=x; MyToken=t1');
  assert.equal(api.normalizeCookie('uid=1\r\nseid=2\r\ncid=3'), 'UID=1; SEID=2; CID=3');
  for (const missing of ['UID=1; CID=2', 'CID=1; SEID=2', 'UID=1; SEID=2', '']) assert.throws(() => api.normalizeCookie(missing), /Cookie/);
  // 键名含空格的粘贴噪声不是 Cookie 项，丢掉而不是报错
  assert.equal(api.normalizeCookie('UID=1; evil header=2; CID=3; SEID=4'), 'UID=1; CID=3; SEID=4');

  // 4. requestJson：UA、Cookie、禁止跳转，以及 115 与非 115 域名的两套解析
  const ok = transport(json({ state: true, data: { user_id: '7' } }));
  assert.deepEqual(await api.requestJson(ok.fetch, 'https://my.115.com/?ct=ajax', { headers: { X: '1' } }, 'UID=7'), { state: true, data: { user_id: '7' } });
  assert.equal(ok.calls[0].options.headers['User-Agent'], api.USER_AGENT);
  assert.equal(ok.calls[0].options.headers.Cookie, 'UID=7');
  assert.equal(ok.calls[0].options.headers.X, '1');
  assert.equal(ok.calls[0].options.redirect, 'manual', '跟随跳转会把“登录失效”伪装成一次成功请求');
  // 无 Cookie 时不发送空的 Cookie 头
  const bare = transport(json({ state: true }));
  await api.requestJson(bare.fetch, 'https://webapi.115.com/files', {}, '');
  assert.equal('Cookie' in bare.calls[0].options.headers, false);

  const big = transport(json('{"data":{"id":9007199254740993}}'));
  assert.deepEqual(await api.requestJson(big.fetch, 'https://webapi.115.com/files', {}, 'x'), { data: { id: '9007199254740993' } });
  const other = transport(json('{"data":{"id":9007199254740993}}'));
  assert.equal(typeof (await api.requestJson(other.fetch, 'https://inpaint.com/api/x', {}, 'x')).data.id, 'number', '非 115 域名保持原生 JSON.parse');

  await assert.rejects(() => api.requestJson(transport(json('{}', 302)).fetch, 'https://webapi.115.com/files'), /重新登录或发生了跳转/);
  await assert.rejects(() => api.requestJson(transport(json('{}', 403)).fetch, 'https://webapi.115.com/files'), /HTTP 403/);
  await assert.rejects(() => api.requestJson(transport(json('not json')).fetch, 'https://webapi.115.com/files'), /无法识别的响应/);
  const broken = transport(Object.assign(Error('连接超时'), { status: 302 }));
  await assert.rejects(() => api.requestJson(broken.fetch, 'https://webapi.115.com/files?cid=0', {}, ''), error => {
    assert.match(error.message, /webapi\.115\.com\/files：连接超时/);
    assert.equal(error.transportError, true, '传输错误要能和“服务器返回了业务失败”区分开');
    assert.equal(error.status, undefined, '底层错误的残留字段不能被当成响应状态');
    return true;
  });

  // 5. 账户
  // 请求体写成原始文本：这里的 user_id 必须是 115 真实返回的裸数字，用 JS 字面量会先在本测试里丢精度。
  const account = transport(json('{"state":true,"data":{"user_info":{"user_id":12345678901234567890,"user_name":"小明"}}}'));
  assert.deepEqual(await api.getAccount((url, options, cookie) => api.requestJson(account.fetch, url, options, cookie), 'UID=1'), { uid: '12345678901234567890', nickname: '小明' });
  assert.deepEqual(await api.getAccount(async url => ({ state: true, data: { uname: 'anon' } }), 'x; UID=42; y'), { uid: '42', nickname: 'anon' }, '响应里没有 UID 时回退到 Cookie');
  await assert.rejects(() => api.getAccount(async () => ({ state: true, data: {} }), 'CID=1'), /没有有效的 UID/);

  // 6. 目录列表：is_dir 优先，没有标志时用 fid/cid 推断，ID 非法的行整条丢弃
  const listFolders = async (rows, cid = '0') => api.getFolders(async () => ({ state: true, data: rows }), 'UID=1', cid);
  assert.deepEqual(await listFolders([
    { cid: '20', n: 'season' },                       // 无 is_dir：cid 就是目录自身 ID
    { fid: '0', cid: '21', n: 's2', is_dir: 1 },      // 有 is_dir
    { fid: '0', cid: '22', n: 'file?', is_dir: 0 },   // 标志说了算，不因 fid 为 0 当目录
    { fid: '88', n: 'episode.mkv' },                  // 文件
    { cid: '0', n: 'root' },                          // 自身 ID，不能作为子目录
    { cid: '23', n: '' },                             // 无名目录
  ]), [{ cid: '20', name: 'season', parent: '0' }, { cid: '21', name: 's2', parent: '0' }]);
  assert.deepEqual(await listFolders({ list: [{ cid: '30', name: 'named' }] }), [{ cid: '30', name: 'named', parent: '0' }], 'data.list 与 name/file_name 同样接受');
  assert.deepEqual(await listFolders([{ cid: '0', file_id: '31', n: 'deep' }], '31'), [{ cid: '31', name: 'deep', parent: '31' }], '返回自身 cid 时改用 file_id，且不会与父目录混淆');
  await assert.rejects(() => api.getFolders(async () => ({ state: false, errno: 99 }), 'UID=1'), /重新登录/);

  // 7. 保存目录核验
  const folderCheck = (result, folder, uid) => api.validateSaveFolder(async () => result, 'UID=' + uid, folder, uid);
  assert.deepEqual(await folderCheck({ state: true, path: [{ cid: '0', name: '根' }, { cid: '42', name: '待归档' }] }, { cid: '42', name: '旧名' }, '123'), { cid: '42', name: '待归档', uid: '123' });
  assert.deepEqual(await folderCheck({ state: true }, { cid: '0', name: 'whatever' }, '123'), { cid: '0', name: '根目录', uid: '123' }, '根目录不需要查询');
  await assert.rejects(() => folderCheck({ state: true }, { cid: '42', uid: '999' }, '123'), /不匹配/);
  await assert.rejects(() => folderCheck({ state: true }, { cid: 'abc' }, '123'), /ID无效/);
  await assert.rejects(() => folderCheck({ state: true, path: [{ cid: '41', name: 'x' }] }, { cid: '42' }, '123'), /未确认所选目录/);
  assert.deepEqual(await folderCheck({ state: true, data: { path: [{ file_id: '42', n: 'via data' }] } }, { cid: '42' }, '123'), { cid: '42', name: 'via data', uid: '123' }, 'path 藏在 data 里、用 file_id 表示时同样认');
  // 核验通过时不能顺带发起第二次请求：一次查询就够，避免误触发风控。
  const once = [];
  await api.validateSaveFolder(async url => { once.push(url); return { state: true, path: [{ cid: '42', name: 'ok' }] }; }, 'UID=1', { cid: '42' }, '1');
  assert.equal(once.length, 1);

  // 8. 桌面端确实委托到这里，防止以后两边各改一份
  const main = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /require\('\.\/share115-api\.js'\)/);
  for (const fn of ['normalizeCookie', 'parse115Json', 'check115', 'getAccount', 'getFolders', 'validateSaveFolder'])
    assert.match(main, new RegExp(`function ${fn}\\([^)]*\\)\\s*\\{\\s*(?:return\\s+)?share115Api\\.${fn}\\(`), `${fn} 又变回 main.js 里的副本了`);
  // 手机端打包清单必须带上它，否则 APK 里的引用会在运行时炸
  const files = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).build.files;
  assert.ok(files.includes('share115-api.js'));

  console.log('PASS 115 大整数保精度、登录失效判定、Cookie 归一化与缺字段拒绝、UA/Cookie/禁跳转、115 与非 115 两套解析、传输错误可区分、账户 UID 回退、目录推断与非法 ID 丢弃、保存目录单次核验、桌面端委托与打包清单');
})().catch(error => { console.error(error); process.exitCode = 1; });
