package ui.bwdd.cloudsave.standalone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
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
 * 115 登录窗。对应桌面端那个 persist:cloudsave-115 分区窗口：
 * 用户在真页面里登录，我们从系统 Cookie 罐里把 UID/CID/SEID/KID 取回来。
 */
public class LoginActivity extends Activity {

  private static final String LOGIN_URL = "https://115.com/";
  private static final String[] WANTED = {"UID", "CID", "SEID", "KID"};
  private static final String[][] PROBE_URLS = {
      {"https://my.115.com/", "my.115.com"},
      {"https://webapi.115.com/", "webapi.115.com"},
      {"https://115.com/", "115.com"},
  };

  private WebView web;

  @Override
  protected void onCreate(Bundle savedState) {
    super.onCreate(savedState);
    LinearLayout root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(0xff101014);

    LinearLayout bar = new LinearLayout(this);
    bar.setOrientation(LinearLayout.HORIZONTAL);
    bar.setGravity(Gravity.CENTER_VERTICAL);
    bar.setPadding(dp(12), dp(12) + statusBarHeight(), dp(8), dp(8));

    TextView hint = new TextView(this);
    hint.setText("在这个页面里登录 115，成功后点「完成」");
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
    // 115 的登录流程会跳到 passport 域名再跳回来，不接受第三方 Cookie 就永远登不上。
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
    CookieManager.getInstance().setAcceptCookie(true);
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onReceivedSslError(WebView view, final SslErrorHandler handler, SslError error) {
        // 115 用的是公共 CA 的证书，这里报证书错误说明要么时钟不对要么在被人中间截获，
        // 所以只给「取消」和「这一次继续」，不像 NAS 外壳那样提供长期信任。
        new AlertDialog.Builder(LoginActivity.this)
            .setTitle("证书校验没通过")
            .setMessage("115 的证书异常（" + reason(error.getPrimaryError()) + "）。\n\n"
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
    web.loadUrl(LOGIN_URL);
  }

  private void finishWithCookie() {
    CookieManager manager = CookieManager.getInstance();
    manager.flush();
    Map<String, String> found = new LinkedHashMap<String, String>();
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
        for (String wanted : WANTED) {
          if (wanted.equals(name) && !value.isEmpty() && !found.containsKey(wanted)) {
            found.put(wanted, value);
          }
        }
      }
    }
    Intent data = new Intent();
    JSONObject result = new JSONObject();
    String cookie = join(found);
    try {
      if (cookie.isEmpty()) {
        result.put("error", "没有读到 115 的登录 Cookie，说明这个页面里还没登录成功");
      } else {
        result.put("cookie", cookie);
      }
    } catch (Exception ignored) {
      // JSONObject.put 只在键名非法时抛，这里不会。
    }
    data.putExtra("result", result.toString());
    setResult(cookie.isEmpty() ? RESULT_CANCELED : RESULT_OK);
    AppLog.write(this, "info", cookie.isEmpty() ? "登录窗关闭，没有取到凭据" : "登录窗取回凭据：" + found.keySet());
    finish();
  }

  private static String join(Map<String, String> values) {
    StringBuilder builder = new StringBuilder();
    for (String wanted : WANTED) {
      String value = values.get(wanted);
      if (value == null) {
        continue;
      }
      if (builder.length() > 0) {
        builder.append("; ");
      }
      builder.append(wanted).append('=').append(value);
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
