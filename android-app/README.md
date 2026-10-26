# 云存助手 独立版（手机端 APK，不依赖 NAS）

一个装进手机就能用的 115 转存客户端：登录 115、选保存目录、粘贴分享链接、扫描、转存、逐项核验。
没有 Docker、没有 NAS、没有远程桌面——界面和业务逻辑都在这个 apk 里。

包名 `ui.bwdd.cloudsave.standalone`，和套壳版（`ui.bwdd.cloudsave.shell`）是两个独立应用，可以同时装。

## 为什么是这个架构

手机要跑仓库里那份 JS，只有两条路，我选了第二条：

| 方案 | 结果 |
| --- | --- |
| nodejs-mobile（把 Node 塞进 apk） | 官方 android 发布包只有 `bin/<abi>/libnode.so`（arm64 实测 62,475,584 字节）和 C/C++ 头文件，没有 Java 封装也没有 AAR。要自己写 NDK + CMake + JNI 生命周期，apk 直接过 60MB。这台机器没有模拟器也没有实机，这条路交付的东西等于完全没验证过。 |
| **WebView 跑同一份 JS + 原生 HTTP 桥** | 界面是本地页面，`share115-*.js` 原样打进 apk；只有网络请求和凭据存储下沉到 Java。没有 NDK，每一层都能在本机测。 |

代价说清楚：WebView 版本由系统决定，太旧的机器要先在系统应用里升级 Android System WebView；页面起手会做一次 `?.` / `??` 语法探测，不满足就明确提示「升级到 80 以上」，而不是白屏。

## 目录

```
AndroidManifest.xml                        只有 INTERNET 权限；allowBackup=false；禁明文
assets/www/index.html|app.css              界面
assets/www/host.js                         页面与原生层唯一的接缝：替换 fetch、暴露 CsStore/CsHost
assets/www/app.js                          手机端应用层：登录、选目录、扫描、分片转存、核验
assets/www/cloudsave-modules.js            构建时生成，不入库（见下）
src/.../StandaloneActivity.java            本地 WebView、桥挂载、登录回传、销毁顺序
src/.../LoginActivity.java                 115 登录窗 + 第三方 Cookie + 读取凭据
src/.../HttpBridge.java                    HTTPS-only 的 HttpURLConnection 传输
src/.../SecretStore.java                   AndroidKeyStore AES-256-GCM 存 Cookie
src/.../NativeBridge.java                  @JavascriptInterface 的 8 个入口
src/.../AppLog.java                        logcat + filesDir/cloudsave-phone.log
tools/bundle.cjs                           把 cloudsave-windows 的模块内联成一份可求值的 JS
build.ps1                                  node bundle → aapt2 → javac → d8 → 手工写入 dex 与 assets → zipalign → apksigner → 条目名门禁
res/mipmap-*/ic_launcher.png               与套壳版同一套图标
```

没有 Gradle、没有 AndroidX、没有任何第三方依赖。构建只要一个 Android SDK（platforms + build-tools）和一个 JDK。

## 手机端和桌面端共用一份站点逻辑

`tools/bundle.cjs` 把 `cloudsave-windows/` 里的
`share115-api.js`、`share115-provider.js`、`share115-verify.js`、`share115-filters.js`
**原文内联**进一个自执行的模块表——不转译、不改写、不复制一份手机专用实现。115 改版时修一次，两边一起生效。

- 打包清单外的 `require()`、任何非 `./` 的依赖，在构建期直接报错，不会留到运行时。
- 生成物 `assets/www/cloudsave-modules.js` 被 gitignore，避免和源文件漂移；`build.ps1` 每次构建都会重新生成。
- `cloudsave-windows/tests/test-android-bundle.cjs` 在没有 `require` 的沙箱里求值这份产物，跑一遍扫描+转存+核验，再和桌面端模块逐项对比行为；同时校验 app.js 的分片大小、换账户判定与桌面端一致，页面控件一个都不缺。
- `share115-api.js` 是从 `main.js` 里抽出来的，桌面端只剩转发。`tests/test-share115-api.cjs` 会断言 `main.js` 仍然是转发，谁再复制一份出来测试就红。

## 构建

```powershell
cd android-app
.\build.ps1                                              # 调试签名
.\build.ps1 -Release -KeystorePass (Get-Content cloudsave-standalone-release.password -Raw).Trim()
```

产物 `build/CloudSave-Standalone-<versionName>.apk`（文件名里的版本从 `AndroidManifest.xml` 读，不会和包内版本对不上）。
默认 SDK 路径 `C:\Android-sdk`，用 `-Sdk D:\other-sdk` 覆盖；脚本自动取 `build-tools`/`platforms` 下版本号最大的目录。

三个必须保留的构建细节：

- **`javac -parameters` 不能去掉**：JDK 21 会给内部类合成的 `this$0` 写一个名字为 null 的 `MethodParameters` 条目，build-tools 34.0.0 的 d8 读到就 `NullPointerException`。
- **`build.ps1` 只能写 ASCII**：Windows PowerShell 5.1 对无 BOM 的 `.ps1` 按本机代码页解码，中文注释会把脚本读碎。界面文案在 `assets/` 和 `res/values/strings.xml` 里，那些是 UTF-8 数据，不受影响。
- **assets 不能用 `aapt2 link -A`**：Windows 上的 aapt2 会把目录条目写成 `assets/www\index.html`（前缀用 `/`、相对段用 `\`），Android 的 `AssetManager` 认不出来，WebView 起手就是 `net::ERR_FILE_NOT_FOUND`。所以 `build.ps1` 里 `aapt2 link` 不带 `-A`，assets 由 step 4 逐个用正斜杠名字写进 zip，step 7 再按字节读一遍中央目录做门禁：任何条目名里有 `\`、或者缺必需条目，构建直接失败。

签名与对齐的顺序不能反：先 `zipalign -f 4` 再 `apksigner sign`，否则签名会被重排破坏。

## 发布签名

`cloudsave-standalone-release.keystore`（alias `cloudsave-standalone`，RSA-2048，有效期 10000 天）与
`cloudsave-standalone-release.password` 都在 `.gitignore` 里，**不要提交、不要上传到任何网络盘**。
这个别名和套壳版的密钥是两个不同的东西，以后覆盖安装必须用同一个 keystore——换密钥就装不上旧包。

当前发布证书指纹（覆盖安装前可以核对，也是判断 apk 有没有被动过最快的办法）：

```
CN=CloudSave Standalone, OU=Phone, O=bwdd-ui, C=CN
SHA-256: 26a90120d2053d6ada0e9fe27ec590bc23a68f33d174164e753c31de4b8fdfb2
```

`apksigner verify -v` 现在报 v1+v2+v3 全部为 true。调试签名和发布签名的包互相不能覆盖安装，先卸一个。

## 凭据与信任边界

- **minSdk 23** 是为了 `AndroidKeyStore` 的 AES-256-GCM：Cookie 用设备芯片里的密钥加密后写进应用私有目录，导出这个目录也拿不到明文。
- **明文回退**：个别 ROM 的密钥库会拒绝第三方应用生成密钥。这时 `SecretStore` 退回明文保存，并在界面上明确写出「系统密钥库不可用……凭据改为明文保存在应用私有目录，卸载即消失」，运行日志里同一条 `warning`。这是行为变化，不是静默降级——宁可提示，也不要让用户以为加密还在。
- 只允许 HTTPS：manifest `usesCleartextTraffic="false"`，`HttpBridge` 和页面 `fetch` 两道都会拒绝非 HTTPS。云盘接口全在 HTTPS 后面，明文一条都不发。
- 桥只挂在本地页面（`file:///android_asset/...`）。任何非本地地址的跳转都丢给系统浏览器，不会带着 `CsNative` 跑。
- 115 登录窗（`LoginActivity`）允许第三方 Cookie，因为它的登录是 `passport.115.com` 一跳跳转；只在这个窗口开，主界面不开。
- 证书报错只给「取消」和「这一次继续」，不给「永久信任」。对公信站点的证书异常，要么改系统时间，要么当下有人在中间——永久信任等于把后者变成常态。
- `allowBackup="false"`：系统备份不会把凭据带进另一个账号的设备。
- 登录状态只在用户点「退出」时删除（`CsStore.setSecret('cookie115','')`），应用不会把凭据发往任何第三方地址。

## 这一版有什么、没什么

有：115 网页登录 / 手动粘贴 Cookie、账户与 UID 读取、保存目录浏览与选择、分享链接扫描（分页与重复检测）、
按 50 项分片转存、每片前重新确认账户 UID、可选的逐项目标目录核验、取消、运行日志。

没有（有意留到后面几轮）：定时监控、其它站点、磁力离线、资源库、历史记录与导出、多账户、
筛选条件（天数/大小/格式）界面——`share115-filters.js` 已经打进包里，只是还没接进手机界面。

## 版本

| 版本 | 情况 |
| --- | --- |
| 0.1.0 / versionCode 1 | 首个独立版。**实机装上了、打不开**：首屏 `net::ERR_FILE_NOT_FOUND`，原因是上面第三条构建细节——apk 里 5 个 assets 条目名全是反斜杠。已废弃，别再装。 |
| 0.1.1 / versionCode 2 | 修掉 assets 条目名，并在构建里加了字节级门禁。**与 0.1.0 同一把签名密钥，直接覆盖安装即可，不用先卸载。** |

## 验证状态：这台机器上没在真机跑过

我没有任何 Android 设备或模拟器（这台是 OpenStack 虚机，不支持嵌套虚拟化）。以下结论全是离线得到的：

- 发布签名构建通过；`apksigner verify` v1/v2/v3 为 true；`zipalign -c 4` 通过。
- `aapt2 dump badging`：包名、versionCode 2 / versionName 0.1.1、minSdk 23、targetSdk 34、只有 INTERNET、启动 Activity 正确；应用名在 `resources.arsc` 里确实是 UTF-8 中文。
- apk 条目名按字节读中央目录复核过：16 个条目，一个反斜杠都没有，5 个 `assets/www/*` 与磁盘文件逐字节同哈希。（0.1.0 当时只用了 `unzip -l` 和 Python `zipfile.namelist()` 看，这两个都会在读取时把 `\` 归一成 `/`，所以那句「条目名全部用 `/`」是错的，问题正是在手机上才暴露出来。）
- `classes.dex` 里 16 个类齐（两个 Activity 加内部类、桥、密钥库、日志）。
- JS 侧：`test-share115-api.cjs` + `test-android-bundle.cjs`，以及桌面全量 152/152。

**必须由你在手机上实测的**：安装能否成功、首屏能否出来（WebView 版本）、115 登录窗能否读到 Cookie、
目录浏览、一次真实转存与核验、退出后凭据是否真删掉、返回键与切后台不崩。
出问题请把「运行日志」面板复制或截屏，同时给一下机型和 Android 版本。日志同时落在应用私有目录
`/data/data/ui.bwdd.cloudsave.standalone/files/cloudsave-phone.log`（超 512KB 自动截尾，保留后半 256KB），
普通文件管理器看不到这个路径，要读它得 `adb shell run-as ui.bwdd.cloudsave.standalone cat files/cloudsave-phone.log`；
日常排障直接用界面那个面板就行。
发布签名的包不给远程调试，只有 `.\build.ps1` 的调试版能配 `chrome://inspect` 看页面。

## 安装

1. apk 传到手机（文件管理器、`adb install` 都行）。
2. 点击安装，允许「未知来源」。自构建未上架，系统一定会警告一次。
3. 打开 → 登录 115 → 选目录 → 粘贴分享链接 → 扫描 → 转存。
