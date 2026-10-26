package ui.bwdd.cloudsave.standalone;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.RandomAccessFile;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 手机上的运行日志：logcat 一份，私有目录里留一份。
 * 留文件是因为大多数反馈发生在没插 adb 的时候，「设置里把日志发我」比让人连调试线现实。
 */
final class AppLog {

  private static final String TAG = "CloudSave";
  private static final long TRIM_AT_BYTES = 512 * 1024;
  private static final int KEEP_BYTES = 256 * 1024;

  private AppLog() {
  }

  static void write(Context context, String level, String message) {
    String line = new SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(new Date())
        + " [" + level + "] " + message;
    Log.i(TAG, line);
    try {
      File file = new File(context.getApplicationContext().getFilesDir(), "cloudsave-phone.log");
      if (file.length() > TRIM_AT_BYTES) {
        trim(file);
      }
      RandomAccessFile handle = new RandomAccessFile(file, "rw");
      handle.seek(handle.length());
      handle.write((line + "\n").getBytes("UTF-8"));
      handle.close();
    } catch (Exception ignored) {
      // 日志写不下去不该影响转存本身。
    }
  }

  private static void trim(File file) throws Exception {
    RandomAccessFile handle = new RandomAccessFile(file, "rw");
    long length = handle.length();
    if (length > KEEP_BYTES) {
      byte[] tail = new byte[KEEP_BYTES];
      handle.seek(length - KEEP_BYTES);
      handle.readFully(tail);
      handle.setLength(0);
      handle.write(tail);
    }
    handle.close();
  }
}
