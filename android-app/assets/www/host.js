// 手机端与原生层之间唯一的接缝。
// 页面里的 fetch 会被换成原生连接：第三方网盘接口不会给这个页面返回 CORS 头，
// 浏览器内直接 fetch 一定被拦，桌面端不存在这个问题因为它本来就不在网页里发请求。
(function () {
  'use strict';

  var native = window.CsNative;
  var boot = document.getElementById('boot-error');

  function fail(message) {
    if (boot) {
      boot.textContent = message;
      boot.hidden = false;
    }
  }

  if (!native) {
    fail('原生桥没有加载。这个页面只能从云存助手手机端里打开，不能直接在浏览器里看。');
    return;
  }

  // 版本门槛：不用 new Function 探测语法，因为打包进来的站点代码本身就只能被足够新的引擎解析——
  // 解析失败时 window.CloudSave 根本不存在，这个判据比 eval 出来的样例更准（也不依赖 eval）。
  // Array.prototype.at 是运行时才用到的（Chrome 92），语法探测抓不到它，单独判一下。
  if (!window.CloudSave || !Array.prototype.at) {
    fail('系统 WebView 版本过旧，无法运行界面逻辑。请到系统应用里把 Android System WebView 升级到 92 以上。');
    return;
  }

  function httpCall(request) {
    var raw = native.http(JSON.stringify(request));
    var result;
    try { result = JSON.parse(raw); } catch (error) { throw new Error('原生网络层返回了无法解析的内容'); }
    if (!result || result.error) throw new Error((result && result.error) || '请求失败');
    return result;
  }

  function asResponse(result) {
    var headers = result.headers || {};
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      headers: { get: function (name) { return headers[String(name).toLowerCase()] || null; } },
      text: function () { return Promise.resolve(result.body || ''); },
      // 聚影的接口只回 JSON，模块里写的就是 response.json()；解析失败交给调用方判，桥不替业务做决定。
      json: function () { return Promise.resolve(JSON.parse(result.body || '')); },
    };
  }

  // 原生调用是同步的（JavaBridge 线程上排队执行），所以这里用 setTimeout 把它推出当前帧，
  // 界面才有机会在长请求期间继续刷新；取消按钮也才有响应。
  globalThis.fetch = function (input, init) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        try {
          var url = String(input);
          if (!/^https:\/\//i.test(url)) throw new Error('只允许 HTTPS 请求：' + url);
          var body = init && init.body != null ? String(init.body) : null;
          var result = httpCall({
            url: url,
            method: (init && init.method) || 'GET',
            headers: (init && init.headers) || {},
            body: body,
          });
          resolve(asResponse(result));
        } catch (error) {
          reject(error);
        }
      }, 0);
    });
  };

  window.CsStore = {
    secret: function (key) { return native.secretGet(key) || ''; },
    setSecret: function (key, value) { native.secretSet(key, value == null ? '' : String(value)); },
    get: function (key, fallback) { var value = native.plainGet(key); return value === '' ? (fallback == null ? '' : fallback) : value; },
    set: function (key, value) { native.plainSet(key, String(value)); },
    log: function (level, message) { native.log(String(level || 'info'), String(message || '')); },
    // 不带参数就是 115 登录窗（转存页用）；带参数时由原生层在那个地址上完成登录或网站验证，
    // 结果照样从 CsHost.onLogin 送回。资源库用这条来清七味的验证页、取聚影的登录态。
    login: function (request) { native.login(request ? JSON.stringify(request) : ''); },
    info: function () { try { return JSON.parse(native.info()); } catch (error) { return {}; } },
  };

  window.CsHost = window.CsHost || {};
})();
