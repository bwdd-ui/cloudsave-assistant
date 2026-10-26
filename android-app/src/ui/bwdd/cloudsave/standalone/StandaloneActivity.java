package ui.bwdd.cloudsave.standalone;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * 手机独立版的主界面：一个全屏 WebView 跑界面与站点逻辑，网络与存储交给原生桥。
 *
 * 和「云存助手手机外壳」的区别是这里不连任何服务器：页面在 APK 里，转存请求由手机自己发。
 */
public class StandaloneActivity extends Activity {

  private static final int REQUEST_LOGIN = 1;
  private static final String START_PAGE = "file:///android_asset/www/index.html";
  private static final String LOCAL_PREFIX = "file:///android_asset/www/";

  private WebView web;

  @Override
  protected void onCreate(Bundle savedState) {
    super.onCreate(savedState);
    web = new WebView(this);
    setContentView(web);

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    // 界面在 APK 的 assets 里，关掉这个就只剩白屏。
    settings.setAllowFileAccess(true);
    settings.setAllowContentAccess(false);
    settings.setDomStorageEnabled(false);
    settings.setCacheMode(WebSettings.LOAD_DEFAULT);

    if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      // 只给调试签名的包开：连上 adb 就能用 chrome://inspect 看页面里发生了什么。
      WebView.setWebContentsDebuggingEnabled(true);
    }

    web.addJavascriptInterface(new NativeBridge(this), "CsNative");
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (url.startsWith(LOCAL_PREFIX)) {
          return false;
        }
        AppLog.write(StandaloneActivity.this, "info", "本地页面试图跳出，已交给系统浏览器：" + url);
        openExternally(url);
        return true;
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
          AppLog.write(StandaloneActivity.this, "error", "界面加载失败：" + error.getDescription());
          notifyPage("warning", "界面加载失败：" + error.getDescription());
        }
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
        AppLog.write(StandaloneActivity.this, "page", message.messageLevel() + ": " + message.message());
        return true;
      }
    });

    CookieManager.getInstance().setAcceptCookie(true);
    web.loadUrl(START_PAGE);
  }

  void openLogin() {
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        startActivityForResult(new Intent(StandaloneActivity.this, LoginActivity.class), REQUEST_LOGIN);
      }
    });
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode != REQUEST_LOGIN) {
      return;
    }
    String payload = data == null ? null : data.getStringExtra("result");
    if (payload == null || payload.isEmpty()) {
      payload = "{\"cancelled\":true}";
    }
    final String script = payload;
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (web != null) {
          web.evaluateJavascript("window.CsHost && window.CsHost.onLogin && window.CsHost.onLogin(" + script + ")", null);
        }
      }
    });
  }

  /** 把只有原生层才知道的消息送回页面的日志里（例如系统密钥库退回明文）。 */
  void notifyPage(final String level, final String message) {
    final String script = "window.CsHost && window.CsHost.onSystemLog && window.CsHost.onSystemLog("
        + JSONObject.quote(level) + "," + JSONObject.quote(message) + ")";
    runOnUiThread(new Runnable() {
      @Override
      public void run() {
        if (web != null) {
          web.evaluateJavascript(script, null);
        }
      }
    });
  }

  private void openExternally(String url) {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    } catch (Exception error) {
      AppLog.write(this, "warning", "没有应用能打开这个地址：" + url);
    }
  }

  String getVersionName() {
    try {
      PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
      return info.versionName == null ? "?" : info.versionName;
    } catch (Exception error) {
      return "?";
    }
  }

  static String webViewVersion() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return "?";
    }
    PackageInfo info = android.webkit.WebView.getCurrentWebViewPackage();
    return info == null || info.versionName == null ? "?" : info.versionName;
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
      if (web.getParent() instanceof android.view.ViewGroup) {
        ((android.view.ViewGroup) web.getParent()).removeView(web);
      }
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
