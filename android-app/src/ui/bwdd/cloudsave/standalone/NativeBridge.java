package ui.bwdd.cloudsave.standalone;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

/**
 * 页面能调到的全部原生能力，除此之外网页拿不到任何东西。
 *
 * 这些方法在 WebView 的 JavaBridge 线程上串行执行，所以同步发一个 HTTP 请求不会卡住界面绘制，
 * 只会让排在它后面的桥调用等一会儿。
 */
final class NativeBridge {

  private final StandaloneActivity activity;
  private final SharedPreferences prefs;
  private final SecretStore secrets;

  NativeBridge(StandaloneActivity activity) {
    this.activity = activity;
    Context context = activity.getApplicationContext();
    this.prefs = context.getSharedPreferences("plain", Context.MODE_PRIVATE);
    this.secrets = new SecretStore(context);
  }

  @JavascriptInterface
  public String http(String requestJson) {
    return HttpBridge.http(requestJson);
  }

  @JavascriptInterface
  public String secretGet(String key) {
    String value = secrets.get(key);
    reportSecretWarning();
    return value;
  }

  @JavascriptInterface
  public void secretSet(String key, String value) {
    secrets.set(key, value);
    reportSecretWarning();
  }

  @JavascriptInterface
  public String plainGet(String key) {
    return prefs.getString(key, "");
  }

  @JavascriptInterface
  public void plainSet(String key, String value) {
    prefs.edit().putString(key, value == null ? "" : value).apply();
  }

  @JavascriptInterface
  public void log(String level, String message) {
    AppLog.write(activity, level, message);
  }

  @JavascriptInterface
  public void login() {
    activity.openLogin();
  }

  @JavascriptInterface
  public String info() {
    JSONObject info = new JSONObject();
    try {
      String version = activity.getPackageName();
      info.put("package", version);
      info.put("version", activity.getVersionName());
      info.put("webview", StandaloneActivity.webViewVersion());
      info.put("os", "Android " + android.os.Build.VERSION.RELEASE + " (API " + android.os.Build.VERSION.SDK_INT + ")");
    } catch (Exception ignored) {
      // 版本信息只是用来打印在页脚，缺了不影响功能。
    }
    return info.toString();
  }

  private void reportSecretWarning() {
    String warning = secrets.warning();
    if (!warning.isEmpty()) {
      AppLog.write(activity, "warning", warning);
      activity.notifyPage("warning", warning);
    }
  }
}
