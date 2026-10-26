# 云存助手 独立版（手机端 APK，不依赖 NAS）

一个装进手机就能用的云存助手：打开就是资源库（不用登录任何网盘就能翻、能搜、能看磁力），
要转存时再切到「转存」标签登录 115、选保存目录、粘贴分享链接、扫描、转存、逐项核验。
没有 Docker、没有 NAS、没有远程桌面——界面和业务逻辑都在这个 apk 里。

包名 `ui.bwdd.cloudsave.standalone`，和套壳版（`ui.bwdd.cloudsave.shell`）是两个独立应用，可以同时装。

## 为什么是这个架构

手机要跑仓库里那份 JS，只有两条路，我选了第二条：

| 方案 | 结果 |
| --- | --- |
| nodejs-mobile（把 Node 塞进 apk） | 官方 android 发布包只有 `bin/<abi>/libnode.so`（arm64 实测 62,475,584 字节）和 C/C++ 头文件，没有 Java 封装也没有 AAR。要自己写 NDK + CMake + JNI 生命周期，apk 直接过 60MB。这台机器没有模拟器也没有实机，这条路交付的东西等于完全没验证过。 |
| **WebView 跑同一份 JS + 原生 HTTP 桥** | 界面是本地页面，`share115-*.js` 原样打进 apk；只有网络请求和凭据存储下沉到 Java。没有 NDK，每一层都能在本机测。 |

代价说清楚：WebView 版本由系统决定，太旧的机器要先在系统应用里升级 Android System WebView。页面起手不跑代码探测，只看两件事——打包模块有没有加载成功、`Array.prototype.at` 在不在（Chrome 92 起）。这条线是运行时依赖，任何「解析得过去」的探测都抓不到它，所以判据必须是能力本身，不是语法。不满足就在页面上写明「升级到 92 以上」，而不是白屏。

## 目录

```
AndroidManifest.xml                        只有 INTERNET 权限；allowBackup=false；禁明文
assets/www/index.html|app.css              界面：顶部两个标签 + 共用的运行日志
assets/www/host.js                         页面与原生层唯一的接缝：替换 fetch、暴露 CsStore/CsHost
assets/www/shell.js                        共享外壳：标签切换、日志、页脚版本；默认落在资源库
assets/www/app.js                          转存面板：登录、选目录、扫描、分片转存、核验
assets/www/library.js                      资源库面板：分类/筛选/搜索/翻页/详情/复制磁力，不需要任何登录
assets/www/cloudsave-modules.js            构建时生成，不入库（见下）
src/.../StandaloneActivity.java            本地 WebView、桥挂载、登录回传、销毁顺序
src/.../LoginActivity.java                 115 登录窗 + 第三方 Cookie + 读取凭据
src/.../HttpBridge.java                    HTTPS-only 的 HttpURLConnection 传输
src/.../SecretStore.java                   AndroidKeyStore AES-256-GCM 存 Cookie
src/.../NativeBridge.java                  @JavascriptInterface 的 8 个入口
src/.../AppLog.java                        logcat + filesDir/cloudsave-phone.log
tools/bundle.cjs                           把 cloudsave-windows 的模块内联成一份可求值的 JS
tools/preview.cjs                          开发用：没有手机也在真 Chromium 里跑这份页面（不进 apk）
build.ps1                                  node bundle → aapt2 → javac → d8 → 手工写入 dex 与 assets → zipalign → apksigner → 条目名门禁
res/mipmap-*/ic_launcher.png               与套壳版同一套图标
```

没有 Gradle、没有 AndroidX、没有任何第三方依赖。构建只要一个 Android SDK（platforms + build-tools）和一个 JDK。

## 手机端和桌面端共用一份站点逻辑

`tools/bundle.cjs` 把 `cloudsave-windows/` 里的 7 个模块**原文内联**进一个自执行的模块表——不转译、不改写、不复制一份手机专用实现。站点改版时修一次，两边一起生效。

| 模块 | 手机端用它做什么 |
| --- | --- |
| `share115-api.js` | 115 接口与大整数安全的 JSON 解析 |
| `share115-provider.js` | 分享快照、转存提交 |
| `share115-verify.js` | 逐项目标目录核验 |
| `share115-filters.js` | 天数/大小/格式筛选（界面还没接上） |
| `site-reader.js` | 读取队列、超时与取消的公共底座 |
| `filtered-library-pages.js` | 官网不支持的筛选（如按年份）在本地翻页时保持一致结果 |
| `btbtla-provider.js` | BT 影视资源站的目录/详情解析，就是资源库标签背后那一份 |

- 打包清单外的 `require()`、任何非 `./` 的依赖，在构建期直接报错，不会留到运行时。
- **唯一的例外是 Node 内置模块**：`btbtla-provider.js` 解析 `.torrent` 本体要用 `crypto`，WebView 里没有。它登记在 `HOST_PROVIDED`（`crypto` → `window.CsShims.crypto`），由页面运行时提供；这台设备上没提供，于是在**调用那一刻**抛「这台设备上没有 CsShims.crypto，该功能目前只在桌面端可用」，而不是静默给出一个空结果。磁力离线下载接上手机时，给 `CsShims.crypto` 填个实现就行，模块不用改。
- 生成物 `assets/www/cloudsave-modules.js` 被 gitignore，避免和源文件漂移；`build.ps1` 每次构建都会重新生成。
- `cloudsave-windows/tests/test-android-bundle.cjs` 在没有 `require` 的沙箱里求值这份产物：跑一遍扫描+转存+核验，再用假的 `parseHtml`/`fetchHtml` 跑通资源库的目录与详情（分页没跳转要报错、停止标志要生效、详情要带回清晰度与磁力），分别验证「有 shim / 没 shim」两条路；同时校验分片大小、换账户判定、脚本顺序与页面控件。
- `cloudsave-windows/tests/test-android-preview.cjs` 测的是测试台本身：注入不改盘、只放 HTTPS、secrets 与 plain 两间存储不串、目录不逃逸。它不可信，后面每一轮的「浏览器里验过」都是空的。
- `share115-api.js` 是从 `main.js` 里抽出来的，桌面端只剩转发。`tests/test-share115-api.cjs` 会断言 `main.js` 仍然是转发，谁再复制一份出来测试就红。

## 没有手机怎么验这份页面

这台机器是 OpenStack 虚机，不支持嵌套虚拟化，装不了 Android 模拟器，也没有实机。`tools/preview.cjs`
起了个本地服务：原样提供 `assets/www/` 里那几个文件，只在 HTML 里插一行假 `CsNative`——
`http` 用同步 XHR 打到一个同源代理（这样才和 JavaBridge 线程一样是阻塞的），代理照着 `HttpBridge.java`
的契约实现（只放 HTTPS、不跟跳转、头字段小写、按 content-type 的 charset 解码、32MB 上限）。
浏览器在这里唯一替掉的是「CORS 拦截」，而那正是原生桥存在的理由，其余逻辑一行没改。

```powershell
node android-app/tools/preview.cjs            # http://127.0.0.1:8801/
```

启动时它会自己跑一遍 `bundle.cjs`：产物不入库，干净检出里如果还要人手先跑一步，这个测试台就总会被跳过；
更要紧的是，留着上一次的旧产物，浏览器里验的就不再是当前源码。`tests/test-android-preview.cjs`
故意先写一份假的旧产物再启动，用它来钉住这条。

0.1.2 的资源库、标签切换、详情与复制磁力就是在这里对着真实站点验的（32 条列表、翻页、搜索命中、
详情里 1080P 种子）；它同时抓出过三个只有实机才会暴露的问题。这不能替代你在手机上的安装验证，
只能把「装上了才发现打不开」的比例降下来。

## 构建

```powershell
cd android-app
.\build.ps1                                              # 调试签名
.\build.ps1 -Release -KeystorePass (Get-Content cloudsave-standalone-release.password -Raw).Trim()
```

产物 `build/CloudSave-Standalone-<versionName>.apk`（文件名里的版本从 `AndroidManifest.xml` 读，不会和包内版本对不上）。
默认 SDK 路径 `C:\Android-sdk`，用 `-Sdk D:\other-sdk` 覆盖；脚本自动取 `build-tools`/`platforms` 下版本号最大的目录。

必须保留的构建细节：

- **`javac -parameters` 不能去掉**：JDK 21 会给内部类合成的 `this$0` 写一个名字为 null 的 `MethodParameters` 条目，build-tools 34.0.0 的 d8 读到就 `NullPointerException`。
- **`build.ps1` 只能写 ASCII**：Windows PowerShell 5.1 对无 BOM 的 `.ps1` 按本机代码页解码，中文注释会把脚本读碎。界面文案在 `assets/` 和 `res/values/strings.xml` 里，那些是 UTF-8 数据，不受影响。
- **进 apk 的源码必须是 LF**：apk 里的 `cloudsave-modules.js` 是把桌面端 7 个模块**逐字节内联**出来的，`assets/www/` 其余文件也是逐字节复制。仓库里存的是 LF，但 Windows 上 `core.autocrlf=true` 会在检出时改成 CRLF——那样同一份提交在两台机器上打出不同的 apk（实测差 367 字节），我也就没法再说「手机上跑的就是仓库里那份」。两道保险：`.gitattributes` 把 `*.js *.cjs *.mjs *.html *.css` 钉成 `eol=lf`（新检出直接给 LF）；`tools/bundle.cjs` 读到 CRLF 就归一回 LF 并在控制台点名哪些文件被这台机器的 git 改过，所以内联进去的永远等于提交里的字节。`build.ps1` 再挡一道：页面文件里还有 CR 就停止构建，因为它复制的是磁盘字节，归一只能发生在打包之前而不是包里。测试拿一份 CRLF 的源文件真打一遍，要求结果和这里逐字节相同。
- **assets 不能用 `aapt2 link -A`**：Windows 上的 aapt2 会把目录条目写成 `assets/www\index.html`（前缀用 `/`、相对段用 `\`），Android 的 `AssetManager` 认不出来，WebView 起手就是 `net::ERR_FILE_NOT_FOUND`。所以 `build.ps1` 里 `aapt2 link` 不带 `-A`，assets 由 step 4 逐个用正斜杠名字写进 zip，step 7 再按字节读一遍中央目录做门禁：任何条目名里有 `\`、或者缺必需条目，构建直接失败。
- **必需条目从 `index.html` 推出来**：step 7 解析页面里 `src`/`href` 指向的本地文件，逐个要求它们在 apk 里。往页面加一个脚本不必同时记得改构建脚本——名单落后一步，手机上就是一个打不开的 `ERR_FILE_NOT_FOUND`，正是 0.1.0 踩过的那类坑。

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

## 和桌面端比，这一版复现了多少

桌面端（`cloudsave-windows/`）的功能面是：5 个资源库站点 + 自定义分享源 + 盘搜、7 个网盘、
按网站与磁力两种监控、离线下载与逐集筛选、历史/导出/归档。手机端目前只覆盖其中一小块，
下面这张表是按模块名一条条对出来的，不是估计。

| 能力 | 桌面端 | 手机端 0.1.2 | 说明 |
| --- | --- | --- | --- |
| 115 分享链接转存（扫描/分片/逐项核验/取消） | ✅ | ✅ | 同一份 `share115-*.js`，语义逐条测过 |
| 115 登录（系统 WebView 读 Cookie）/ 手动粘贴 | ✅ | ✅ | 只在「转存」标签里需要 |
| 保存目录浏览与选择 | ✅ | ✅ | |
| 资源库：BT影视（分类/筛选/搜索/翻页/详情/磁力） | ✅ | ✅ | `btbtla-provider.js` 同一份，起手不落登录页 |
| 资源库：不太灵、观影、七味、聚影、自定义分享源 | ✅ | ❌ | 各自的 provider 还没进打包清单；BT影视是第一个，接口最干净（不用站点登录、纯 HTTPS 文本） |
| 盘搜（聚合搜索） | ✅ | ❌ | `haisou-renderer.js` 依赖桌面端多窗口 |
| 其它 6 个网盘（光鸭/123盘/夸克/天翼/迅雷/百度） | ✅ | ❌ | 只有 115 的公共层被抽成了可复用模块 |
| 磁力离线下载（提交到网盘离线） | ✅ | ❌ | 缺两块：`.torrent` 本体过不了文本桥；`crypto` 算 info_hash 无人提供（现在会明确报「只在桌面端」） |
| 网站监控 / 磁力监控（定时自动跑） | ✅ | ❌ | **结构性阻碍**：Android 上应用退到后台就没了，需要 WorkManager 或前台服务，不是把 JS 搬过去就行 |
| 「立即检查」手动监控（点开才跑一次） | ✅ | 可做 | 不需要后台能力，下一轮性价比最高的一项 |
| 转存历史、搜索、导出 XLSX、归档 | ✅ | ❌ | 桌面端靠 `json-writer`/`portable-storage` 等文件层，手机端只有 SharedPreferences + 私有目录 |
| 筛选条件界面（天数/大小/格式） | ✅ | ❌ | `share115-filters.js` 已经打进包里，只差界面 |
| 多账户、托盘、开机自启、远程页面 | ✅ | ❌ | 手机端不做 |

结论：**核心转存链路 + 一个资源库站点已经复现，其余是「没接」而不是「接不了」**；
真正被平台卡住的只有「无人值守的定时监控」这一项。

## 版本

| 版本 | 情况 |
| --- | --- |
| 0.1.0 / versionCode 1 | 首个独立版。**实机装上了、打不开**：首屏 `net::ERR_FILE_NOT_FOUND`，原因是上面第三条构建细节——apk 里 5 个 assets 条目名全是反斜杠。已废弃，别再装。 |
| 0.1.1 / versionCode 2 | 修掉 assets 条目名，并在构建里加了字节级门禁。**与 0.1.0 同一把签名密钥，直接覆盖安装即可，不用先卸载。** |
| 0.1.2 / versionCode 3 | 加「资源库」标签（BT影视，不登录就能浏览），页面起手落在这里，不再强制登录；打包清单从 4 个模块扩到 7 个；WebView 过旧判定改成不依赖 eval 的能力判据（门槛 92）；必需条目改为从 `index.html` 推导；换行归一化后重打，包内字节不再随检出方式变化。**同一把密钥，覆盖安装即可。** |

## 验证状态：这台机器上没在真机跑过

我没有任何 Android 设备或模拟器（这台是 OpenStack 虚机，不支持嵌套虚拟化）。以下结论全是离线得到的：

- 发布签名构建通过；`apksigner verify` v1/v2/v3 为 true；`zipalign -c 4` 通过。
- 产物 `CloudSave-Standalone-0.1.2.apk`：124,156 字节，sha256 `d83c0f11b4e80b91127424831abed60da8d4eed22bf07b42f637f227efec4216`。
- **这个包现在是可复现的**：另开一份全新克隆（本机 `core.autocrlf=true` 照旧开着）跑 `node android-app/tools/bundle.cjs`，得到同一份 46,530 字节、sha256 `766ba4dc138df302a78b1b6b4ccc298a1e820380dd4975f79a4dad8d2bc655e3` 的内联结果。修之前不是这样——apk 里内联的是被检出改成 CRLF 的源码，换台机器算不出同一个包，所以我先打的那次 0.1.2 已作废重打（旧字节归档在备份的 `superseded/apk/`，别装）。
- 干净克隆里全量测试同样通过：**153/153**。这条也是这轮补上的——以前 `git am`/`git clone` 出来的树里 `test-android-preview.cjs` 必红，因为产物不入库又没人先生成它。
- `aapt2 dump badging`：包名、versionCode 3 / versionName 0.1.2、minSdk 23、targetSdk 34、只有 INTERNET、启动 Activity 正确。
- apk 条目名按字节读中央目录复核过（构建门禁之外又用独立脚本重读一遍）：**18 个条目，0 个反斜杠；`assets/www/` 7 个文件与磁盘逐一 CRC 相符**，回读解压后字节数一致。（0.1.0 当时只用了 `unzip -l` 和 Python `zipfile.namelist()` 看，这两个都会在读取时把 `\` 归一成 `/`，所以那句「条目名全部用 `/`」是错的，问题正是在手机上才暴露出来。）
- 门禁现在从 `index.html` 推导必需条目，本次报出 6 个引用（app.css + 5 个脚本）全部在包内。
- `classes.dex` 里 16 个类齐（两个 Activity 加内部类、桥、密钥库、日志）——这一轮没动原生层。
- JS 侧：`test-android-bundle.cjs`（含资源库目录/详情、shim 有与无两条路）、`test-android-preview.cjs`（测试台自身契约）、`test-share115-api.cjs`，桌面全量 **153/153 通过，19 个因缺 electron 跳过**。
- 页面在真 Chromium 里对着真实站点跑过：无登录直接出 32 条资源、翻页、搜索命中、详情里读到 1080P 种子与磁力；标签切到「转存」时未登录的按钮正确禁用；控制台无报错。**apk 里那 7 个文件与浏览器验过的磁盘文件 CRC 相同**，所以这条验证是能算数的。

**必须由你在手机上实测的**：安装能否成功、首屏能否直接出资源库（这一版不该再要登录）、
列表与详情里的海报/磁力是否正常、切到「转存」标签后 115 登录窗能否读到 Cookie、
目录浏览、一次真实转存与核验、退出后凭据是否真删掉、返回键与切后台不崩。
出问题请把「运行日志」面板复制或截屏，同时给一下机型和 Android 版本。日志同时落在应用私有目录
`/data/data/ui.bwdd.cloudsave.standalone/files/cloudsave-phone.log`（超 512KB 自动截尾，保留后半 256KB），
普通文件管理器看不到这个路径，要读它得 `adb shell run-as ui.bwdd.cloudsave.standalone cat files/cloudsave-phone.log`；
日常排障直接用界面那个面板就行。
发布签名的包不给远程调试，只有 `.\build.ps1` 的调试版能配 `chrome://inspect` 看页面。

## 安装

1. apk 传到手机（文件管理器、`adb install` 都行）。
2. 点击安装，允许「未知来源」。自构建未上架，系统一定会警告一次。
3. 打开就是「资源库」：直接翻、搜、看磁力，不需要任何登录。
4. 要转存再点顶部「转存」→ 登录 115 → 选目录 → 粘贴分享链接 → 扫描 → 转存。
