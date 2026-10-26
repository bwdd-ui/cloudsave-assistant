package ui.bwdd.cloudsave.standalone;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.zip.GZIPInputStream;
import java.util.zip.InflaterInputStream;

/**
 * 页面里的 fetch 走这里发请求。
 *
 * 为什么不直接在 WebView 里 fetch：网盘接口不会给本地页面返回 CORS 头，浏览器内核会先把请求拦掉。
 * 桌面端也没有这个问题——它的请求本来就不是从网页里发的。
 */
final class HttpBridge {

  private static final int CONNECT_TIMEOUT_MS = 10000;
  private static final int READ_TIMEOUT_MS = 20000;
  private static final int MAX_BODY_BYTES = 32 * 1024 * 1024;

  private HttpBridge() {
  }

  static String http(String requestJson) {
    HttpURLConnection connection = null;
    try {
      JSONObject request = new JSONObject(requestJson);
      URL url = new URL(request.getString("url"));
      if (!"https".equalsIgnoreCase(url.getProtocol())) {
        return failure("只允许 HTTPS 请求：" + url.getProtocol() + "://" + url.getHost());
      }
      connection = (HttpURLConnection) url.openConnection();
      connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
      connection.setReadTimeout(READ_TIMEOUT_MS);
      // 不自动跟随跳转：桌面端把 3xx 当成「登录态失效」的信号，跟随后就看不到了。
      connection.setInstanceFollowRedirects(false);
      connection.setRequestProperty("Accept-Encoding", "identity");

      JSONObject headers = request.optJSONObject("headers");
      if (headers != null) {
        for (Iterator<String> keys = headers.keys(); keys.hasNext(); ) {
          String name = keys.next();
          String value = headers.optString(name, null);
          if (value != null) {
            connection.setRequestProperty(name, value);
          }
        }
      }

      String method = request.optString("method", "GET").toUpperCase();
      boolean hasBody = !request.isNull("body");
      connection.setRequestMethod(method);
      if (hasBody) {
        byte[] payload = request.getString("body").getBytes("UTF-8");
        connection.setDoOutput(true);
        connection.setFixedLengthStreamingMode(payload.length);
        OutputStream out = connection.getOutputStream();
        out.write(payload);
        out.flush();
        out.close();
      }

      int status = connection.getResponseCode();
      String body = read(connection);
      JSONObject result = new JSONObject();
      result.put("status", status);
      result.put("body", body);
      result.put("headers", headerFields(connection));
      return result.toString();
    } catch (Exception error) {
      return failure(describe(error));
    } finally {
      if (connection != null) {
        connection.disconnect();
      }
    }
  }

  private static JSONObject headerFields(HttpURLConnection connection) throws JSONException {
    JSONObject headers = new JSONObject();
    for (String name : connection.getHeaderFields().keySet()) {
      if (name != null) {
        headers.put(name.toLowerCase(), connection.getHeaderField(name));
      }
    }
    return headers;
  }

  private static String read(HttpURLConnection connection) throws IOException {
    InputStream stream = connection.getResponseCode() >= 400
        ? connection.getErrorStream() : connection.getInputStream();
    if (stream == null) {
      return "";
    }
    String encoding = connection.getContentEncoding();
    if (encoding != null && encoding.toLowerCase().contains("gzip")) {
      stream = new GZIPInputStream(stream);
    } else if (encoding != null && encoding.toLowerCase().contains("deflate")) {
      stream = new InflaterInputStream(stream);
    }
    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
    byte[] chunk = new byte[8192];
    int read;
    int total = 0;
    while ((read = stream.read(chunk)) > 0) {
      total += read;
      if (total > MAX_BODY_BYTES) {
        throw new IOException("响应超过 32MB，这个接口不该返回这么大");
      }
      buffer.write(chunk, 0, read);
    }
    stream.close();
    return buffer.toString(charsetOf(connection));
  }

  private static String charsetOf(HttpURLConnection connection) {
    String type = connection.getContentType();
    if (type != null) {
      String match = null;
      for (String part : type.split(";")) {
        String trimmed = part.trim().toLowerCase();
        if (trimmed.startsWith("charset=")) {
          match = trimmed.substring("charset=".length()).replace("\"", "");
        }
      }
      if (match != null && !match.isEmpty()) {
        return match;
      }
    }
    return "UTF-8";
  }

  private static String describe(Exception error) {
    String message = error.getMessage();
    if (message == null || message.isEmpty()) {
      message = error.getClass().getSimpleName();
    }
    return message;
  }

  private static String failure(String message) {
    // JSONObject.put 会抛 JSONException，错误路径上不想再多一层。
    return "{\"error\":" + JSONObject.quote(message) + "}";
  }
}
