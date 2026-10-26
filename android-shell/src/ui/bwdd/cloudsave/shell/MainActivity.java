package ui.bwdd.cloudsave.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.SslErrorHandler;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Full screen WebView pointed at the container's HTTPS address.
 *
 * There is deliberately no login form in this shell: the session lives in the WebView cookie jar, so
 * this app never holds a copy of the container password. HTTPS only, because the container serves TLS
 * itself and a cleartext LAN address would be blocked by the platform anyway at this targetSdk.
 */
public class MainActivity extends Activity {
  static final String PREFS = "shell";
  static final String KEY_URL = "url";
  static final String TRUST_PREFIX = "trust_";

  private static final String[] MENU_ITEMS = {
      "刷新", "地址设置", "清除登录状态", "用系统浏览器打开", "关于"};
  private static final int[] CORNERS = {
      Gravity.TOP | Gravity.END, Gravity.TOP | Gravity.START,
      Gravity.BOTTOM | Gravity.END, Gravity.BOTTOM | Gravity.START};

  private WebView web;
  private TextView menuButton;
  private FrameLayout panel;
  private TextView panelTitle;
  private TextView panelDetail;
  private TextView panelAddress;
  private ProgressBar progress;
  private SharedPreferences prefs;
  private String loadedUrl = "";
  private int menuCorner = 0;
  private boolean loadFailed;
  // 「本次继续」applies to the whole page, and a single-page client pulls several assets over the
  // same failing socket; without this the prompt returns once per request.
  private final java.util.Set<String> sessionTrust = new java.util.HashSet<String>();

  private SslErrorHandler pendingSsl;
  private AlertDialog sslDialog;
  private AlertDialog menuDialog;

  @Override
  protected void onCreate(Bundle savedState) {
    super.onCreate(savedState);
    prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    // A transfer keeps running inside the container; the screen switching off would only freeze the
    // picture until the next touch, so keep it lit while this shell is in the foreground.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    // The remote desktop is dark; a white window background flashes before the first frame arrives.
    getWindow().setBackgroundDrawable(new ColorDrawable(0xff101014));
    setContentView(buildLayout());

    CookieManager.getInstance().setAcceptCookie(true);
    android.webkit.WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setSupportZoom(false);
    settings.setBuiltInZoomControls(false);
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(true);
    web.setBackgroundColor(0xff101014);
    web.setOverScrollMode(View.OVER_SCROLL_NEVER);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        loadFailed = false;
        if (panel.getVisibility() != View.VISIBLE) {
          progress.setVisibility(View.VISIBLE);
        }
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        progress.setVisibility(View.GONE);
        // A failed load still ends with onPageFinished, and WebView has no getErrorUrl() to ask.
        if (!loadFailed) {
          hidePanel();
        }
      }

      @Override
      public void onReceivedError(WebView view, int code, String description, String failingUrl) {
        loadFailed = true;
        showPanel("连不上这个地址", explain(code, description), failingUrl);
      }

      @Override
      public void onReceivedHttpError(WebView view, WebResourceRequest request,
          WebResourceResponse response) {
        // Sub-resource 404s are normal inside the container page; only a failed main frame means the
        // user is looking at a blank screen with no explanation.
        if (request.isForMainFrame()) {
          loadFailed = true;
          showPanel("容器返回了错误", "HTTP " + response.getStatusCode() + " " + response.getReasonPhrase()
              + "\n\n如果是 401，说明这个容器开了登录密码，需要用有权限的账号打开。", request.getUrl().toString());
        }
      }

      @Override
      public void onReceivedSslError(final WebView view, final SslErrorHandler handler, SslError error) {
        handleSslError(handler, error);
      }
    });

    web.setDownloadListener(new DownloadListener() {
      @Override
      public void onDownloadStart(String url, String userAgent, String contentDisposition,
          String mimeType, long contentLength) {
        offerDownload(url, mimeType, contentLength);
      }
    });

    // The ⋮ overlay is the only way out of a stuck page, so it needs to be reachable with one thumb.
    menuButton.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        showMenu();
      }
    });
    // Long press parks the button in another corner: whatever the container draws there stays
    // reachable, which matters because this overlay eats the touch it sits on.
    menuButton.setOnLongClickListener(new View.OnLongClickListener() {
      @Override
      public boolean onLongClick(View v) {
        menuCorner = (menuCorner + 1) % CORNERS.length;
        FrameLayout.LayoutParams p = (FrameLayout.LayoutParams) menuButton.getLayoutParams();
        p.gravity = CORNERS[menuCorner];
        menuButton.setLayoutParams(p);
        return true;
      }
    });

    loadConfigured();
  }

  private View buildLayout() {
    FrameLayout root = new FrameLayout(this);

    web = new WebView(this);
    root.addView(web, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

    progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    progress.setIndeterminate(true);
    FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, dp(3));
    pp.gravity = Gravity.TOP;
    progress.setVisibility(View.GONE);
    root.addView(progress, pp);

    panel = new FrameLayout(this);
    panel.setBackgroundColor(0xf0101014);
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL);
    column.setGravity(Gravity.CENTER);
    column.setPadding(dp(22), dp(22), dp(22), dp(22));
    panelTitle = new TextView(this);
    panelTitle.setTextSize(18f);
    panelTitle.setTextColor(Color.WHITE);
    panelTitle.setText("还没有配置地址");
    column.addView(panelTitle);
    panelDetail = new TextView(this);
    panelDetail.setTextSize(14f);
    panelDetail.setTextColor(0xddffffff);
    panelDetail.setPadding(0, dp(10), 0, 0);
    column.addView(panelDetail);
    panelAddress = new TextView(this);
    panelAddress.setTextSize(12f);
    panelAddress.setTextColor(0x99ffffff);
    panelAddress.setPadding(0, dp(10), 0, 0);
    column.addView(panelAddress);

    Button retry = new Button(this);
    retry.setText("重试");
    retry.setMinHeight(dp(44));
    retry.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        loadConfigured();
      }
    });
    LinearLayout.LayoutParams rp = new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    rp.topMargin = dp(18);
    column.addView(retry, rp);

    Button settings = new Button(this);
    settings.setText("打开地址设置");
    settings.setMinHeight(dp(44));
    settings.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        openSettings();
      }
    });
    column.addView(settings, rp);

    FrameLayout.LayoutParams sp = new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
    panel.addView(column, sp);
    panel.setVisibility(View.GONE);
    root.addView(panel, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

    menuButton = new TextView(this);
    menuButton.setText("⋮");
    menuButton.setTextSize(22f);
    menuButton.setGravity(Gravity.CENTER);
    menuButton.setTextColor(Color.WHITE);
    menuButton.setBackground(new ColorDrawable(0x66000000));
    FrameLayout.LayoutParams mp = new FrameLayout.LayoutParams(dp(40), dp(40));
    mp.gravity = CORNERS[0];
    mp.rightMargin = dp(8);
    mp.topMargin = dp(8);
    root.addView(menuButton, mp);

    return root;
  }

  private void loadConfigured() {
    String url = prefs.getString(KEY_URL, "");
    if (url == null || url.trim().isEmpty()) {
      showPanel("还没有配置地址",
          "先填写 NAS 上云存助手容器的地址，例如 https://192.168.1.20:5800。容器需要已经在运行，"
              + "手机要和它在同一个网络里。", "");
      return;
    }
    url = url.trim();
    if (!url.toLowerCase().startsWith("https://")) {
      showPanel("只支持 HTTPS 地址", "当前保存的是：" + url + "\n\n请在地址设置里改成 https:// 开头的地址。",
          url);
      return;
    }
    loadedUrl = url;
    hidePanel();
    web.loadUrl(url);
  }

  private void handleSslError(final SslErrorHandler handler, SslError error) {
    final String host = Uri.parse(error.getUrl()).getHost();
    if (host == null) {
      handler.cancel();
      return;
    }
    if (prefs.getBoolean(TRUST_PREFIX + host, false) || sessionTrust.contains(host)) {
      handler.proceed();
      return;
    }
    if (pendingSsl != null) {
      // Only one prompt can be answered at a time; the load it belonged to is already gone.
      pendingSsl.cancel();
      if (sslDialog != null) {
        sslDialog.dismiss();
        sslDialog = null;
      }
    }
    pendingSsl = handler;
    sslDialog = new AlertDialog.Builder(this)
        .setTitle("这个地址的证书没有被系统信任")
        .setMessage("容器用的是自签名证书，这在内网里是正常的。\n\n地址：" + host
            + "\n证书问题：" + sslReason(error.getPrimaryError())
            + "\n\n「始终信任」会记住这个主机名，之后不再询问；只在地址设置里可以清除。\n"
            + "如果这不是你自己的 NAS，请点取消。")
        .setCancelable(false)
        .setNegativeButton("取消", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int i) {
            dropSsl();
            handler.cancel();
          }
        })
        .setNeutralButton("本次继续", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int i) {
            sessionTrust.add(host);
            dropSsl();
            handler.proceed();
          }
        })
        .setPositiveButton("始终信任此地址", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int i) {
            prefs.edit().putBoolean(TRUST_PREFIX + host, true).apply();
            dropSsl();
            handler.proceed();
          }
        })
        .show();
  }

  private void dropSsl() {
    pendingSsl = null;
    if (sslDialog != null) {
      sslDialog.dismiss();
      sslDialog = null;
    }
  }

  private static String sslReason(int code) {
    switch (code) {
      case SslError.SSL_IDMISMATCH: return "证书里的域名和访问的地址不一致";
      case SslError.SSL_EXPIRED: return "证书已经过期";
      case SslError.SSL_DATE_INVALID: return "证书日期无效（多半是 NAS 或手机的系统时间不对）";
      case SslError.SSL_NOTYETVALID: return "证书还没生效";
      case SslError.SSL_UNTRUSTED: return "签发机构不在系统信任列表里";
      default: return "证书链校验失败（代码 " + code + "）";
    }
  }

  private void showMenu() {
    if (menuDialog != null) {
      return;
    }
    menuDialog = new AlertDialog.Builder(this)
        .setTitle(shortAddress())
        .setItems(MENU_ITEMS, new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int which) {
            menuDialog = null;
            switch (which) {
              case 0: loadConfigured(); break;
              case 1: openSettings(); break;
              case 2: confirmClearSession(); break;
              case 3: openInBrowser(prefs.getString(KEY_URL, "")); break;
              default: showAbout(); break;
            }
          }
        })
        .setOnDismissListener(new DialogInterface.OnDismissListener() {
          @Override
          public void onDismiss(DialogInterface d) {
            menuDialog = null;
          }
        })
        .show();
  }

  private String shortAddress() {
    String url = prefs.getString(KEY_URL, "");
    return url == null || url.trim().isEmpty() ? "云存助手" : url.trim();
  }

  private void openSettings() {
    startActivity(new Intent(this, SettingsActivity.class));
  }

  private void confirmClearSession() {
    new AlertDialog.Builder(this)
        .setTitle("清除登录状态")
        .setMessage("会删掉这个应用里的 Cookie 和网页存储，下次打开需要重新登录 NAS 容器；"
            + "不会影响网盘账号本身，也不会动 NAS 上的任何数据。")
        .setNegativeButton("取消", null)
        .setPositiveButton("清除", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int i) {
            clearSession();
          }
        })
        .show();
  }

  private void clearSession() {
    CookieManager cm = CookieManager.getInstance();
    cm.removeAllCookies(new android.webkit.ValueCallback<Boolean>() {
      @Override
      public void onReceiveValue(Boolean ignored) {
        cm.flush();
      }
    });
    WebStorage.getInstance().deleteAllData();
    web.clearHistory();
    web.clearCache(true);
    web.clearFormData();
    Toast.makeText(this, "已清除，重新加载页面", Toast.LENGTH_SHORT).show();
    loadConfigured();
  }

  private void openInBrowser(String url) {
    if (url == null || url.trim().isEmpty()) {
      Toast.makeText(this, "还没有配置地址", Toast.LENGTH_SHORT).show();
      return;
    }
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url.trim()))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    } catch (ActivityNotFoundException e) {
      Toast.makeText(this, "这台手机上没有可以打开该地址的应用", Toast.LENGTH_SHORT).show();
    }
  }

  private void offerDownload(final String url, String mimeType, long size) {
    String human = size > 0 ? (size / 1024 < 1024 ? size / 1024 + " KB" : size / 1048576 + " MB") : "大小未知";
    new AlertDialog.Builder(this)
        .setTitle("页面请求下载文件")
        .setMessage("类型：" + (mimeType == null || mimeType.isEmpty() ? "未知" : mimeType)
            + "\n大小：" + human + "\n\n" + url
            + "\n\n导出文件请在电脑上的云存助手里保存。这里只能把链接交给系统浏览器，"
            + "而浏览器没有这个会话的 Cookie，多半会被要求重新登录。")
        .setNegativeButton("关闭", null)
        .setNeutralButton("复制地址", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int i) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("download", url));
            Toast.makeText(MainActivity.this, "地址已复制", Toast.LENGTH_SHORT).show();
          }
        })
        .setPositiveButton("浏览器打开", new DialogInterface.OnClickListener() {
          @Override
          public void onClick(DialogInterface d, int i) {
            openInBrowser(url);
          }
        })
        .show();
  }

  private void showAbout() {
    new AlertDialog.Builder(this)
        .setTitle("云存助手 手机外壳 1.0.1")
        .setMessage("这个应用只是一个全屏 WebView，画面来自 NAS 上运行的云存助手容器"
            + "（Docker 里的 KasmVNC 网页端）。\n\n容器必须开着，转存任务也都在容器里执行。"
            + "手机竖屏体验需要把容器虚拟显示改成 420x900 并设置 CLOUDSAVE_MOBILE_LAYOUT=1，"
            + "详见 docker/MOBILE.md。\n\n右上角的 ⋮ 按钮会挡住它下面那一小块画面，长按可以把它挪到其他角。")
        .setPositiveButton("好", null)
        .show();
  }

  private void showPanel(String title, String detail, String url) {
    panelTitle.setText(title);
    panelDetail.setText(detail);
    panelAddress.setText(url == null || url.isEmpty() ? "" : "地址：" + url);
    progress.setVisibility(View.GONE);
    panel.setVisibility(View.VISIBLE);
  }

  private void hidePanel() {
    panel.setVisibility(View.GONE);
  }

  private static String explain(int code, String description) {
    String text = description == null ? "" : description;
    if (text.contains("CLEARTEXT")) {
      return "平台不允许明文 HTTP 连接。容器默认在 5800 端口提供 HTTPS，请用 https:// 地址。";
    }
    if (code == WebViewClient.ERROR_HOST_LOOKUP) {
      return "域名解析失败。可以改用 NAS 的 IP 地址，例如 https://192.168.1.20:5800。";
    }
    if (code == WebViewClient.ERROR_CONNECT || code == WebViewClient.ERROR_TIMEOUT
        || code == WebViewClient.ERROR_UNKNOWN) {
      return "连接被拒绝或超时。请确认容器正在运行（docker ps）、端口映射对得上，"
          + "以及手机和 NAS 在同一个网段。";
    }
    return "错误代码 " + code + (text.isEmpty() ? "" : "：" + text);
  }

  @Override
  protected void onResume() {
    super.onResume();
    // Coming back from 地址设置 has to pick up the new address without a manual reload.
    String url = prefs.getString(KEY_URL, "");
    if (url != null && !url.trim().isEmpty() && !url.trim().equals(loadedUrl)) {
      loadConfigured();
    }
    web.onResume();
  }

  @Override
  protected void onPause() {
    CookieManager.getInstance().flush();
    web.onPause();
    super.onPause();
  }

  @Override
  public void onBackPressed() {
    // Deprecated on purpose: without AndroidX there is no OnBackPressedDispatcher, and a fresh
    // WebView has no history to walk back through anyway.
    if (panel.getVisibility() == View.VISIBLE) {
      hidePanel();
    } else if (web.canGoBack()) {
      web.goBack();
    } else {
      super.onBackPressed();
    }
  }

  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_MENU) {
      showMenu();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  protected void onDestroy() {
    if (sslDialog != null) {
      sslDialog.dismiss();
      sslDialog = null;
    }
    if (pendingSsl != null) {
      // Leaving while the prompt is up: cancel, so the load does not hang forever.
      pendingSsl.cancel();
      pendingSsl = null;
    }
    if (menuDialog != null) {
      menuDialog.dismiss();
      menuDialog = null;
    }
    CookieManager.getInstance().flush();
    if (web != null) {
      // destroy() with a load still in flight takes the WebView process down on some
      // OEM builds, and getParent() is null when onCreate itself threw.
      web.stopLoading();
      if (web.getParent() instanceof ViewGroup) {
        ((ViewGroup) web.getParent()).removeView(web);
      }
      web.destroy();
    }
    super.onDestroy();
  }

  private int dp(float value) {
    return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
  }
}
