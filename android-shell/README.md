# 云存助手 手机外壳（WebView APK）

一个全屏 WebView，指向 NAS 上云存助手 Docker 容器的 HTTPS 地址。它不是重新实现的客户端：
画面来自容器里的 KasmVNC 网页端，转存任务、网盘登录、监控全部仍在容器内执行。

选这条路的原因：容器已经把完整桌面流出来了，套壳能把「手机能用」这件事的成本压到一个 Activity，
而代价是它依赖容器常开，并且体验受远程桌面画面限制（不是原生控件）。

## 目录

```
AndroidManifest.xml                 包名 ui.bwdd.cloudsave.shell，minSdk 21 / targetSdk 34，只有 INTERNET 权限
res/values/strings.xml              应用名与设置页标题
res/mipmap-*/ic_launcher.png        五种 densities，由 tools/MakeIcons.java 从 icon-source.png 切出
src/.../MainActivity.java           WebView、菜单、证书提示、错误面板、清除登录状态
src/.../SettingsActivity.java       地址设置 + 已信任的证书地址
tools/MakeIcons.java                图标缩放（任意 JDK 可跑）
build.ps1                           构建：aapt2 → javac → d8 → zipalign → apksigner
icon-source.png                     1024px 原始图标
```

没有 Gradle、没有 AndroidX、没有任何第三方依赖。构建只需要一个 Android SDK（platforms + build-tools）和一个 JDK。

## 构建

```powershell
cd android-shell
# 调试签名（自动临时密钥，不能覆盖安装正式包）
.\build.ps1
# 发布签名
.\build.ps1 -Release -KeystorePass (Get-Content cloudsave-shell-release.password -Raw).Trim()
```

产物在 `build/CloudSave-Shell-1.0.apk`。默认 SDK 路径 `C:\Android-sdk`，可以用 `-Sdk D:\other-sdk` 覆盖。
脚本会自动选 `build-tools` 和 `platforms` 下版本号最大的目录。

在 Linux/macOS 上等价命令（PowerShell 脚本本身没做跨平台版本，因为构建机就是 Windows）：

```sh
AAPT2=$SDK/build-tools/34.0.0/aapt2; JAR=$SDK/platforms/android-34/android.jar
"$AAPT2" compile --dir res -o build/res.zip
"$AAPT2" link -o build/linked.apk --manifest AndroidManifest.xml -I "$JAR" build/res.zip
javac -parameters --release 11 -encoding UTF-8 -classpath "$JAR" -d build/classes $(find src -name '*.java')
"$SDK"/build-tools/34.0.0/d8 --release --min-api 21 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
# 把 build/dex/classes.dex 放进 apk 的 zip 根目录，再 zipalign -f 4，最后 apksigner sign
```

**`-parameters` 不能去掉**：JDK 21 给内部类合成构造参数 `this$0` 写了一个名字为 null 的 `MethodParameters`
条目，build-tools 34.0.0 里的 d8 读到它会直接 `NullPointerException`（每个捕获外部实例的内部类都炸）。
加上 `-parameters` 之后名字非空，dex 步骤才通过。这是我在本机踩到的唯一构建阻塞点。

## 安装

1. 把 apk 传到手机上（文件管理器、微信文件、`adb install` 都行）。
2. 点击安装 → 允许「来自未知来源」。这是自己构建的未上架包，系统一定会警告一次。
3. 打开应用 → 右上角 ⋮ → 地址设置 → 填 `https://<NAS 的 IP>:5800` → 保存并返回。
4. 首次连接会弹证书提示（容器用的是自签证书）。看清楚主机名是不是自己的 NAS，再选「始终信任此地址」。

## 安全模型

- **只接受 https:// 地址**。`AndroidManifest` 里显式写了 `usesCleartextTraffic="false"`，
  SettingsActivity 也会拒绝 `http://`。理由：容器本身提供 TLS，明文只会让 NAS 的登录凭据在局域网里裸奔。
- **不保存任何密码**。应用里没有登录表单，Kasm 的 HTTP Basic 弹窗由系统 WebView 自己处理，
  会话在 WebView 的 cookie jar 里。菜单里的「清除登录状态」会清 cookie、DOM storage 和缓存。
- **自签证书默认拒绝**。三个选项：取消 / 本次继续 / 始终信任此地址。「始终信任」按主机名记在
  `SharedPreferences` 里，可以在地址设置页清除；「本次继续」只对当前这次页面加载有效。
- `allowBackup="false"`，不会被 ADB backup 或云备份把 cookie 和偏好设置带出去。
- 只有 `INTERNET` 一个权限，没有存储、定位、网络状态。

## 已知限制

- 容器必须正在运行。容器停了，这个应用只会显示一个错误面板。
- 不是原生界面，是远程桌面画面：文字清晰度受 Kasm 缩放影响，输入要靠容器里的网页控件。
- 右上角的 ⋮ 按钮会挡住它下面那一小块画面。**长按可以把它换到另外三个角**（顺时针循环）。
- 手机浏览器那些「添加到主屏幕」的轻量方案都不适用：容器不是我们能控制清单文件的 PWA。
- 文件下载：这个外壳不会把文件存到手机上，只在弹窗里给出链接（可以复制或交给系统浏览器）。
  导出请走电脑上的云存助手，或者容器的下载目录。
- 状态栏没有隐藏。想要真全屏可以在容器里把虚拟显示高度调小，让画面比例更接近手机。

## 本次构建验证到哪一步

已验证（离线，不需要设备）：

- `aapt2 dump badging`：包名 `ui.bwdd.cloudsave.shell`、versionCode 1 / versionName 1.0、
  sdkVersion 21、targetSdkVersion 34、`android.permission.INTERNET`、label「云存助手」、
  五种 density 的 launcher icon 都能解析、可启动 Activity 是 `.MainActivity`。
- `apksigner verify --print-certs`：签名者 `CN=CloudSave Shell, OU=NAS, O=bwdd-ui, C=CN`，
  证书 SHA-256 `9037747e4d84818104b3487260b3e2cde8ee6d1cad4a14c539be129f814a6cea`。
- `zipalign -c 4` 通过；apk 内 `classes.dex`、`resources.arsc`、5 个 mipmap、二进制 `AndroidManifest.xml` 齐全。
- `apkanalyzer dex packages` 里两个 Activity 和全部内部类都在 dex 中。

**没有验证的：它从没在任何手机或模拟器上跑起来过。** 这台构建机是 OpenStack 虚机，没有嵌套虚拟化，
装不了 Android 模拟器，也没有 adb 连接的设备。所以「WebView 能连上你的容器、证书弹窗出现、
⋮ 菜单可用、返回键行为正确」这些都是静态推断，需要你在真机上确认。

## 签名密钥

`cloudsave-shell-release.keystore` 和它的密码文件被 `.gitignore` 排除，只存在于本机和 T 盘备份里。

这个文件决定你能不能**覆盖安装**新版本：Android 用签名者身份判断升级。丢了它，就只能卸载重装，
手机上的地址配置和登录状态会一起没了。validity 设的 10000 天（约 27 年），到期前记得换 key 并升 versionCode。

不要把它提交进仓库，也不要发到聊天或issue里。
