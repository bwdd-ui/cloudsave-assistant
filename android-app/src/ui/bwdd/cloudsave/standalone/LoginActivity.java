package ui.bwdd.cloudsave.standalone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 应用内打开的真实网页，用来取回那个站点的凭据。
 *
 * 两种用途走同一个窗口：115 登录（默认，读 UID/CID/SEID/KID 这四个名字）和
 * 资源库那边的「网站验证 / 站点登录」（由页面传地址，取回该地址此刻可见的全部 Cookie）。
 * 桌面端每个站点各有一个 persist 分区，这里只有一个系统 Cookie 罐，所以取的时候按 URL 取，
 * 存的时候按站点分键——站点之间不共用凭据这件事在页面层维持。
 */
public class LoginActivity extends Activity {

  static final String DEFAULT_URL = "https://115.com/";
  private static final String[] WANTED = {"UID", "CID", "SEID", "KID"};
  private static final String[][] PROBE_URLS = {
      {"https://my.115.com/", "my.115.com"},
      {"https://webapi.115.com/", "webapi.115.com"},
      {"https://115.com/", "115.com"},
  };

  private WebView web;
  private String targetUrl = DEFAULT_URL;
  private String[] wanted = WANTED;
  private String[] storageKeys = new String[0];
  private boolean harvesting;

  @Override
  protected void onCreate(Bundle savedState) {
    super.onCreate(savedState);
    Intent intent = getIntent();
    String requested = intent == null ? null : intent.getStringExtra("url");
    // 地址由页面传来，所以这里必须自己把关：只接受 https，别的（file://、content://）一律回落到默认值。
    if (requested != null && requested.startsWith("https://") && requested.indexOf('/', 8) > 0) {
      targetUrl = requested;
    }
    String wantedCsv = intent == null ? null : intent.getStringExtra("wanted");
    if (wantedCsv != null) {
      java.util.List<String> names = new java.util.ArrayList<String>();
      for (String name : wantedCsv.split(",")) {
        if (!name.trim().isEmpty()) {
          names.add(name.trim());
        }
      }
      wanted = names.toArray(new String[names.size()]);
    }
    String keysCsv = intent == null ? null : intent.getStringExtra("storageKeys");
    if (keysCsv != null) {
      java.util.List<String> keys = new java.util.ArrayList<String>();
      for (String key : keysCsv.split(",")) {
        if (!key.trim().isEmpty()) {
          keys.add(key.trim());
        }
      }
      storageKeys = keys.toArray(new String[keys.size()]);
    }

    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(0xff101014);

    LinearLayout bar = new LinearLayout(this);
    bar.setOrientation(LinearLayout.HORIZONTAL);
    bar.setGravity(Gravity.CENTER_VERTICAL);
    bar.setPadding(dp(12), dp(12) + statusBarHeight(), dp(8), dp(8));

    TextView hint = new TextView(this);
    String hintText = intent == null ? null : intent.getStringExtra("hint");
    hint.setText(hintText != null && !hintText.isEmpty() ? hintText : "在这个页面里登录 115，成功后点「完成」");
    hint.setTextColor(0xffe8e8ee);
    hint.setTextSize(13f);
    bar.addView(hint, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

    Button done = new Button(this);
    done.setText("完成");
    done.setMinWidth(dp(64));
    done.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        finishWithCookie();
      }
    });
    bar.addView(done, marginLeft(8));

    Button cancel = new Button(this);
    cancel.setText("取消");
    cancel.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        setResult(RESULT_CANCELED);
        finish();
      }
    });
    bar.addView(cancel, marginLeft(8));
    root.addView(bar);

    web = new WebView(this);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    // 登录流程会跳到身份提供方域名再跳回来，不接受第三方 Cookie 就永远登不上。
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
    CookieManager.getInstance().setAcceptCookie(true);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        // 页面里点开的链接如果不是 https，就留在这里不加载：验证/登录流程本身只会走 https。
        if (request.getUrl().toString().startsWith("https://")) {
          return false;
        }
        AppLog.write(LoginActivity.this, "warning", "登录窗口里出现非 HTTPS 地址，已阻止：" + request.getUrl());
        return true;
      }

      @Override
      public void onReceivedSslError(WebView view, final SslErrorHandler handler, SslError error) {
        // 这些站点用的都是公共 CA 的证书，这里报证书错误说明要么时钟不对要么在被人中间截获，
        // 所以只给「取消」和「这一次继续」，不像 NAS 外壳那样提供长期信任。
        new AlertDialog.Builder(LoginActivity.this)
            .setTitle("证书校验没通过")
            .setMessage("这个站点的证书异常（" + reason(error.getPrimaryError()) + "）。\n\n"
                + "常见原因是手机时间不对，或者当前网络在做中间人（公共 WiFi、抓包代理）。"
                + "确认过再点继续，否则请取消。")
            .setNegativeButton("取消", new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface d, int which) {
                handler.cancel();
              }
            })
            .setPositiveButton("这一次继续", new DialogInterface.OnClickListener() {
              @Override
              public void onClick(DialogInterface d, int which) {
                handler.proceed();
              }
            })
            .setCancelable(false)
            .show();
      }
    });
    web.setWebChromeClient(new WebChromeClient());
    root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

    setContentView(root);
    web.loadUrl(targetUrl);
  }

  /**
   * 「完成」要先问页面要一次 localStorage（聚影的 app_user_token 存在那里，Cookie 罐里没有），
   * 拿到之后连同 Cookie 一起结算。要不到也照样结算——浏览列表本来就不需要它。
   */
  private void finishWithCookie() {
    if (harvesting || web == null) {
      return;
    }
    if (storageKeys.length == 0) {
      settle(null);
      return;
    }
    harvesting = true;
    StringBuilder keys = new StringBuilder();
    for (int i = 0; i < storageKeys.length; i++) {
      if (i > 0) {
        keys.append(',');
      }
      keys.append(JSONObject.quote(storageKeys[i]));
    }
    String script = "(function(){var out={};try{var keys=[" + keys + "];for(var i=0;i<keys.length;i++)"
        + "out[keys[i]]=localStorage.getItem(keys[i])||'';}catch(e){}out.__ua=navigator.userAgent||'';"
        + "return JSON.stringify(out);})()";
    web.evaluateJavascript(script, new ValueCallback<String>() {
      @Override
      public void onReceiveValue(String value) {
        harvesting = false;
        JSONObject storage = null;
        try {
          // evaluateJavascript 回的是个 JS 字符串字面量，先去引号再解析里面那份 JSON。
          storage = new JSONObject(new JSONObject("{\"v\":" + value + "}").getString("v"));
        } catch (Exception error) {
          AppLog.write(LoginActivity.this, "warning", "没能从页面里读到本地存储：" + error.getMessage());
        }
        settle(storage);
      }
    });
  }

  private void settle(JSONObject storage) {
    CookieManager manager = CookieManager.getInstance();
    manager.flush();
    Map<String, String> found = new LinkedHashMap<String, String>();
    String cookie;
    if (wanted.length == 0) {
      // 按地址取这个站点此刻可见的全部 Cookie，原样交给页面：它下次请求就带上同一个头。
      String raw = manager.getCookie(targetUrl);
      cookie = raw == null ? "" : raw;
      AppLog.write(this, "info", "站点凭据：" + (cookie.isEmpty() ? "没读到任何 Cookie" : cookie.split(";").length + " 项"));
    } else {
      for (String[] probe : PROBE_URLS) {
        String raw = manager.getCookie(probe[0]);
        if (raw == null) {
          continue;
        }
        for (String part : raw.split(";")) {
          int split = part.indexOf('=');
          if (split <= 0) {
            continue;
          }
          String name = part.substring(0, split).trim();
          String value = part.substring(split + 1).trim();
          for (String key : wanted) {
            if (key.equals(name) && !value.isEmpty() && !found.containsKey(key)) {
              found.put(key, value);
            }
          }
        }
      }
      cookie = join(found);
    }
    Intent data = new Intent();
    JSONObject result = new JSONObject();
    try {
      // url 一定要带回去：现在这个窗口可能是在登录 115，也可能是七味的验证或聚影的登录，
      // 页面那边靠它决定这份凭据归谁，取消和失败也一样要能归位。
      result.put("url", targetUrl);
      if (cookie.isEmpty()) {
        result.put("error", "没有读到这个站点的登录 Cookie，说明这个页面里还没登录成功（或验证还没过）");
      } else {
        result.put("cookie", cookie);
        if (storage != null) {
          result.put("storage", storage);
        }
      }
    } catch (Exception ignored) {
      // JSONObject.put 只在键名非法时抛，这里不会。
    }
    data.putExtra("result", result.toString());
    setResult(cookie.isEmpty() ? RESULT_CANCELED : RESULT_OK);
    AppLog.write(this, "info", cookie.isEmpty() ? "登录窗关闭，没有取到凭据" : "登录窗取回凭据（" + host(targetUrl) + "）");
    finish();
  }

  private static String host(String url) {
    try {
      return Uri.parse(url).getHost();
    } catch (Exception error) {
      return url;
    }
  }

  private String join(Map<String, String> values) {
    StringBuilder builder = new StringBuilder();
    for (String key : wanted) {
      String value = values.get(key);
      if (value == null) {
        continue;
      }
      if (builder.length() > 0) {
        builder.append("; ");
      }
      builder.append(key).append('=').append(value);
    }
    return builder.toString();
  }

  private static String reason(int code) {
    switch (code) {
      case SslError.SSL_UNTRUSTED:
        return "签发方不受信任";
      case SslError.SSL_EXPIRED:
        return "证书已过期";
      case SslError.SSL_IDMISMATCH:
        return "证书域名不匹配";
      case SslError.SSL_NOTYETVALID:
        return "证书还没生效";
      case SslError.SSL_DATE_INVALID:
        return "证书日期异常";
      default:
        return "错误代码 " + code;
    }
  }

  private int statusBarHeight() {
    int id = getResources().getIdentifier("status_bar_height", "dimen", "android");
    return id > 0 ? getResources().getDimensionPixelSize(id) : 0;
  }

  private LinearLayout.LayoutParams marginLeft(int value) {
    LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT,
        ViewGroup.LayoutParams.WRAP_CONTENT);
    params.leftMargin = dp(value);
    return params;
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) {
      web.goBack();
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onPause() {
    CookieManager.getInstance().flush();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    if (web != null) {
      web.stopLoading();
      if (web.getParent() instanceof ViewGroup) {
        ((ViewGroup) web.getParent()).removeView(web);
      }
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }

  private int dp(float value) {
    return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
  }
}
