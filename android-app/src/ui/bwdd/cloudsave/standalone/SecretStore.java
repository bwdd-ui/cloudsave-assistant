package ui.bwdd.cloudsave.standalone;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.UnrecoverableKeyException;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 登录凭据的落盘存储，对应桌面端的 safeStorage。
 *
 * 密钥放在 Android 系统密钥库里，明文不出内存；密文形如 gcm:<base64(iv|ciphertext)>。
 * 少数机器上系统密钥库会抽风（换过签名、被恢复出厂策略清空等），那时退回明文并记下警告，
 * 因为「存不下凭据、软件直接不能用」比「本机私有目录里的明文凭据」更不是用户想要的结果。
 */
final class SecretStore {

  private static final String KEYSTORE = "AndroidKeyStore";
  private static final String ALIAS = "cloudsave-standalone-cookie";
  private static final String PREFIX = "gcm:";
  private static final String PLAIN_PREFIX = "plain:";
  private static final int IV_BYTES = 12;
  private static final int TAG_BITS = 128;

  private final SharedPreferences prefs;
  private String warning = "";

  SecretStore(Context context) {
    prefs = context.getApplicationContext().getSharedPreferences("secrets", Context.MODE_PRIVATE);
  }

  String warning() {
    String value = warning;
    warning = "";
    return value;
  }

  String get(String key) {
    String stored = prefs.getString(key, "");
    if (stored == null || stored.isEmpty()) {
      return "";
    }
    if (stored.startsWith(PLAIN_PREFIX)) {
      return stored.substring(PLAIN_PREFIX.length());
    }
    if (!stored.startsWith(PREFIX)) {
      return "";
    }
    try {
      return decrypt(stored.substring(PREFIX.length()));
    } catch (Exception error) {
      warning = "系统密钥库读不出已保存的凭据（" + message(error) + "），需要重新登录一次";
      return "";
    }
  }

  void set(String key, String value) {
    if (value == null || value.isEmpty()) {
      prefs.edit().remove(key).apply();
      return;
    }
    try {
      prefs.edit().putString(key, PREFIX + encrypt(value)).apply();
    } catch (Exception error) {
      prefs.edit().putString(key, PLAIN_PREFIX + value).apply();
      warning = "系统密钥库不可用（" + message(error) + "），凭据改为明文保存在应用私有目录，卸载即消失";
    }
  }

  private SecretKey key() throws Exception {
    KeyStore store = KeyStore.getInstance(KEYSTORE);
    store.load(null);
    KeyStore.Entry existing = store.getEntry(ALIAS, null);
    if (existing instanceof KeyStore.SecretKeyEntry) {
      return ((KeyStore.SecretKeyEntry) existing).getSecretKey();
    }
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
    generator.init(new KeyGenParameterSpec.Builder(ALIAS,
        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build());
    SecretKey created = generator.generateKey();
    store.setEntry(ALIAS, new KeyStore.SecretKeyEntry(created), null);
    return created;
  }

  private String encrypt(String value) throws Exception {
    byte[] iv = new byte[IV_BYTES];
    new SecureRandom().nextBytes(iv);
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, iv));
    byte[] cipherText = cipher.doFinal(value.getBytes("UTF-8"));
    byte[] packed = new byte[iv.length + cipherText.length];
    System.arraycopy(iv, 0, packed, 0, iv.length);
    System.arraycopy(cipherText, 0, packed, iv.length, cipherText.length);
    return Base64.encodeToString(packed, Base64.NO_WRAP);
  }

  private String decrypt(String encoded) throws Exception {
    byte[] packed = Base64.decode(encoded, Base64.NO_WRAP);
    if (packed.length <= IV_BYTES) {
      throw new UnrecoverableKeyException("密文长度异常");
    }
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, packed, 0, IV_BYTES));
    byte[] plain = cipher.doFinal(packed, IV_BYTES, packed.length - IV_BYTES);
    return new String(plain, "UTF-8");
  }

  private static String message(Exception error) {
    String text = error.getMessage();
    return text == null || text.isEmpty() ? error.getClass().getSimpleName() : text;
  }
}
