package ui.bwdd.cloudsave.shell;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Only the container address plus the hosts whose self-signed certificate was accepted. Nothing else
 * is stored: the container password never reaches this app, and the session stays in the WebView
 * cookie jar where the platform can clear it.
 */
public class SettingsActivity extends Activity {

  private SharedPreferences prefs;
  private EditText address;
  private TextView trustedList;

  @Override
  protected void onCreate(Bundle savedState) {
    super.onCreate(savedState);
    prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);

    ScrollView scroll = new ScrollView(this);
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(dp(20), dp(20), dp(20), dp(24));
    scroll.addView(box);
    setContentView(scroll);

    box.addView(heading("地址设置"));

    address = new EditText(this);
    address.setSingleLine(true);
    address.setHint("https://192.168.1.20:5800");
    address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    String saved = prefs.getString(MainActivity.KEY_URL, "");
    if (saved != null && !saved.isEmpty()) {
      address.setText(saved);
    }
    box.addView(address);

    box.addView(body("容器在 5800 端口用自签名证书提供 HTTPS，这里只接受 https:// 地址。"
        + "手机要和 NAS 在同一个网络里，容器先跑起来。"));

    Button save = new Button(this);
    save.setText("保存并返回");
    save.setMinHeight(dp(48));
    save.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        save();
      }
    });
    box.addView(save, spaced(16));

    box.addView(heading("已信任的证书地址"));
    trustedList = body(trustedHosts());
    box.addView(trustedList);

    Button clear = new Button(this);
    clear.setText("清除已信任的证书地址");
    clear.setMinHeight(dp(48));
    clear.setOnClickListener(new View.OnClickListener() {
      @Override
      public void onClick(View v) {
        clearTrusted();
      }
    });
    box.addView(clear, spaced(8));

    box.addView(body("首次访问一个自签名地址时画面里会弹一次提示，选「始终信任此地址」之后这里才记下它。"
        + "清除之后下次访问会重新询问。"));
  }

  private void save() {
    String value = address.getText().toString().trim();
    if (value.isEmpty()) {
      prefs.edit().remove(MainActivity.KEY_URL).apply();
      finish();
      return;
    }
    if (value.toLowerCase().startsWith("http://")) {
      refuse("明文 HTTP 不被允许",
          "云存助手容器通过 HTTPS 提供服务，这个外壳也不接受明文地址：放行明文只会让 NAS 的登录凭据"
              + "在局域网里裸奔。");
      return;
    }
    if (!value.toLowerCase().startsWith("https://")) {
      value = "https://" + value;
      address.setText(value);
    }
    Uri uri = Uri.parse(value);
    if (uri.getHost() == null || uri.getHost().isEmpty()) {
      refuse("地址看不明白", "请填写完整地址，例如 https://192.168.1.20:5800");
      return;
    }
    prefs.edit().putString(MainActivity.KEY_URL, uri.toString()).apply();
    Toast.makeText(this, "已保存：" + uri.toString(), Toast.LENGTH_SHORT).show();
    finish();
  }

  private void refuse(String title, String detail) {
    new AlertDialog.Builder(this)
        .setTitle(title)
        .setMessage(detail)
        .setPositiveButton("知道了", null)
        .show();
  }

  private String trustedHosts() {
    List<String> hosts = new ArrayList<String>();
    for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
      if (entry.getKey().startsWith(MainActivity.TRUST_PREFIX)) {
        hosts.add(entry.getKey().substring(MainActivity.TRUST_PREFIX.length()));
      }
    }
    if (hosts.isEmpty()) {
      return "（还没有记住任何地址）";
    }
    StringBuilder out = new StringBuilder();
    for (String host : hosts) {
      if (out.length() > 0) {
        out.append('\n');
      }
      out.append("· ").append(host);
    }
    return out.toString();
  }

  private void clearTrusted() {
    int removed = 0;
    SharedPreferences.Editor editor = prefs.edit();
    for (String key : prefs.getAll().keySet()) {
      if (key.startsWith(MainActivity.TRUST_PREFIX)) {
        editor.remove(key);
        removed++;
      }
    }
    editor.apply();
    trustedList.setText(trustedHosts());
    Toast.makeText(this, removed == 0 ? "本来就没有记住的地址" : "已清除 " + removed + " 个地址",
        Toast.LENGTH_SHORT).show();
  }

  private TextView heading(String value) {
    TextView view = body(value);
    view.setTypeface(Typeface.DEFAULT_BOLD);
    view.setTextColor(Color.WHITE);
    return view;
  }

  private TextView body(String value) {
    TextView view = new TextView(this);
    view.setText(value);
    view.setTextSize(14f);
    view.setTextColor(Color.WHITE);
    view.setLineSpacing(0f, 1.25f);
    view.setPadding(0, dp(10), 0, dp(2));
    return view;
  }

  private LinearLayout.LayoutParams spaced(int topDp) {
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    p.topMargin = dp(topDp);
    return p;
  }

  private int dp(float value) {
    return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
  }
}
