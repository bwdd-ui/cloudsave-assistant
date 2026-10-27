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
assets/www/shell.js                        共享外壳：标签切换、日志、页脚版本、登录结果的按地址认领；默认落在资源库
assets/www/app.js                          转存面板：登录、选目录、扫描、分片转存、核验
assets/www/library.js                      资源库面板：三个站点各自的分类/筛选/搜索/翻页/详情/复制磁力，站点凭据分开存
assets/www/cloudsave-modules.js            构建时生成，不入库（见下）
src/.../StandaloneActivity.java            本地 WebView、桥挂载、登录回传、销毁顺序
src/.../LoginActivity.java                 应用内网页窗口：115 登录、七味的人机验证、聚影的站点登录，按地址取 Cookie 与本地存储
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

`tools/bundle.cjs` 把 `cloudsave-windows/` 里的 10 个模块**原文内联**进一个自执行的模块表——不转译、不改写逻辑、不复制一份手机专用实现；唯一动过字节的地方是把检出时被 `core.autocrlf` 改成的 CRLF 归回仓库里存的那个 LF（见下面「进 apk 的源码必须是 LF」）。站点改版时修一次，两边一起生效。

| 模块 | 手机端用它做什么 |
| --- | --- |
| `share115-api.js` | 115 接口与大整数安全的 JSON 解析 |
| `share115-provider.js` | 分享快照、转存提交 |
| `share115-verify.js` | 逐项目标目录核验 |
| `share115-filters.js` | 天数/大小/格式筛选（界面还没接上） |
| `site-reader.js` | 读取队列、超时与取消的公共底座 |
| `filtered-library-pages.js` | 官网不支持的筛选（如按年份）在本地翻页时保持一致结果 |
| `btbtla-provider.js` | BT 影视资源站的目录/详情解析，就是资源库标签背后那一份 |
| `qmp4-provider.js` | 七味的目录/详情解析，含「403 连着验证页一起回」那一判 |
| `jying-provider.js` | 聚影的 JSON 接口：目录、影片信息、资源、网盘链接 |
| `jying-rate-limit.js` | 聚影的冷静期：撞 429/高频判定就停手，把恢复时刻写进本机存储 |

- 打包清单外的 `require()`、任何非 `./` 的依赖，在构建期直接报错，不会留到运行时。
- **唯一的例外是 Node 内置模块**：`btbtla-provider.js` 解析 `.torrent` 本体要用 `crypto`，WebView 里没有。它登记在 `HOST_PROVIDED`（`crypto` → `window.CsShims.crypto`），由页面运行时提供；这台设备上没提供，于是在**调用那一刻**抛「这台设备上没有 CsShims.crypto，该功能目前只在桌面端可用」，而不是静默给出一个空结果。磁力离线下载接上手机时，给 `CsShims.crypto` 填个实现就行，模块不用改。
- 生成物 `assets/www/cloudsave-modules.js` 被 gitignore，避免和源文件漂移；`build.ps1` 每次构建都会重新生成。
- `cloudsave-windows/tests/test-android-bundle.cjs` 在没有 `require` 的沙箱里求值这份产物：跑一遍扫描+转存+核验，再用假的 `parseHtml`/`fetchHtml`/`fetcher` 把资源库三个站点的目录与详情跑通（BT影视的分页与停止标志、七味的「403 + 验证页」翻成 `loginRequired`、聚影的 401、`allowLocked` 未登录仍给影片信息、冷静期落盘后一次网站都不敲），分别验证「有 shim / 没 shim」两条路；同时校验分片大小、换账户判定、脚本顺序、页面控件，以及站点凭据「按站点分键存 → 按地址认领 → 下一次请求带上 Cookie 与那个 UA」这条链。
- `cloudsave-windows/tests/test-android-preview.cjs` 测的是测试台本身：起服务先重打包、注入不改盘、只放 HTTPS、secrets 与 plain 两间存储不串、登录窗夹具带参数并异步回包、目录不逃逸。它不可信，后面每一轮的「浏览器里验过」都是空的。
- `share115-api.js` 是从 `main.js` 里抽出来的，桌面端只剩转发。`tests/test-share115-api.cjs` 会断言 `main.js` 仍然是转发，谁再复制一份出来测试就红。

## 没有手机怎么验这份页面

这台机器是 OpenStack 虚机，不支持嵌套虚拟化，装不了 Android 模拟器，也没有实机。`tools/preview.cjs`
起了个本地服务：原样提供 `assets/www/` 里那几个文件，只在 HTML 里插一行假 `CsNative`——
`http` 用同步 XHR 打到一个同源代理（这样才和 JavaBridge 线程一样是阻塞的），代理照着 `HttpBridge.java`
的契约实现（只放 HTTPS、不跟跳转、头字段小写、按 content-type 的 charset 解码、32MB 上限）。
浏览器在这里唯一替掉的是「CORS 拦截」，而那正是原生桥存在的理由，其余逻辑一行没改。

```powershell
node android-app/tools/preview.cjs            # http://127.0.0.1:8801/
node android-app/tools/preview.cjs --port 8823 --data 存储文件   # 要验站点凭据那条链时用这个
```

启动时它会自己跑一遍 `bundle.cjs`：产物不入库，干净检出里如果还要人手先跑一步，这个测试台就总会被跳过；
更要紧的是，留着上一次的旧产物，浏览器里验的就不再是当前源码。`tests/test-android-preview.cjs`
故意先写一份假的旧产物再启动，用它来钉住这条。

`--data` 指的那个 JSON 里可以多写一间 `loginFor`：按 host 登记的「应用内登录窗结果」夹具，比如
`{"loginFor":{"jying.top":{"url":"https://jying.top/login","cookie":"sessionid=…","storage":{"app_user_token":"…","__ua":"…"}}}}`。
浏览器里开不了那个原生窗口，没夹具就照实回「窗口已取消」，配了就那份凭据原样送回，于是
「点登录 → 按地址认领 → 存进 secrets → 下一次请求带 Cookie」这一整条能在真 Chromium 里走一遍。
出站带 Cookie 时代理打一行长度（不打内容），所以「存了却没用上」这种问题看得见。

0.1.2 的资源库、标签切换、详情与复制磁力就是在这里对着真实站点验的（32 条列表、翻页、搜索命中、
详情里 1080P 种子）；0.1.3 又在这里验了七味（42 条、筛选 5 项、详情 28 个种子 + 6 个网盘链接、
「去转存」把链接和口令填进转存页）与聚影（48 条、筛选 6 项、未登录的详情给影片信息而不给资源、
按 `loginFor` 夹具走完整条凭据链：存好后三条 jying.top 请求各带 55 字节 Cookie，切到七味一条都不带，
115 那份凭据始终是空的）。这里顺带修正我之前一个判断：七味对这台机器的出口网络**不是**读不了，
现在匿名就能翻，只有没通过验证时才弹人机验证。
这些都是离线验证，替代不了你在手机上的安装验证，只能把「装上了才发现打不开」的比例降下来。

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
- **进 apk 的源码必须是 LF**：apk 里的 `cloudsave-modules.js` 是把桌面端 10 个模块**逐字节内联**出来的，`assets/www/` 其余文件也是逐字节复制。仓库里存的是 LF，但 Windows 上 `core.autocrlf=true` 会在检出时改成 CRLF——那样同一份提交在两台机器上打出不同的 apk（实测差 367 字节），我也就没法再说「手机上跑的就是仓库里那份」。两道保险：`.gitattributes` 把 `*.js *.cjs *.mjs *.html *.css` 钉成 `eol=lf`（新检出直接给 LF）；`tools/bundle.cjs` 读到 CRLF 就归一回 LF 并在控制台点名哪些文件被这台机器的 git 改过（这一轮新加的 `qmp4-provider.js`、`jying-rate-limit.js`、`jying-provider.js` 三个就是这样被抓到并归一的），所以内联进去的永远等于提交里的字节。`build.ps1` 再挡一道：页面文件里还有 CR 就停止构建，因为它复制的是磁盘字节，归一只能发生在打包之前而不是包里。测试拿一份 CRLF 的源文件真打一遍，要求结果和这里逐字节相同。
- **assets 不能用 `aapt2 link -A`**：Windows 上的 aapt2 会把目录条目写成 `assets/www\index.html`（前缀用 `/`、相对段用 `\`），Android 的 `AssetManager` 认不出来，WebView 起手就是 `net::ERR_FILE_NOT_FOUND`。所以 `build.ps1` 里 `aapt2 link` 不带 `-A`，assets 由 step 4 逐个用正斜杠名字写进 zip，step 7 再按字节读一遍中央目录做门禁：任何条目名里有 `\`、或者缺必需条目，构建直接失败。
- **必需条目从 `index.html` 推出来**：step 7 解析页面里 `src`/`href` 指向的本地文件，逐个要求它们在 apk 里。往页面加一个脚本不必同时记得改构建脚本——名单落后一步，手机上就是一个打不开的 `ERR_FILE_NOT_FOUND`，正是 0.1.0 踩过的那类坑。

签名与对齐的顺序不能反：先 `zipalign -f 4` 再 `apksigner sign`，否则签名会被重排破坏。

**zip 条目时间戳必须钉住**：条目时间算进签名字节里。aapt2 用它看到的资源文件 mtime 给自己那几条盖章，我手写的 `classes.dex` 与 `assets/*` 也用当时时刻，于是同一个提交在两个目录里构建出两个不同哈希的 apk（都是 124,156 字节，sha 不同），连续构建两次也不同。step 4 现在把**每一条**都改成固定的 2024-01-01T00:00:00Z，两次构建、两个目录才算出同一个包。

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
- 同一个窗口现在也用来过七味的人机验证、登聚影的站点账号。这时它按地址取「这个站点此刻可见的全部 Cookie」，
  外加页面上指定的那几个 localStorage 键（聚影要 `app_user_token`）；取回来按地址认领——`www.qmp4.com` 的归七味、
  `jying.top` 的归聚影、115 域名的归转存面板，各存各的 `site:<id>`，谁也不会串到别人那份上，115 那份尤其不受影响。
  这些凭据只在给该站点发请求时挂上（`headersFor(site)` 造的头部只交给那一个 provider 用，请求地址也都来自它自己）；
  退出 115 不清它们，因为它们是另一批站点的。要说清一条：这里挡串用的不是通用的域名白名单，
  而是「每个站点的凭据只进它自己那个 provider」这个结构——以后接新的站点要走同一条，别在页面层拼 Cookie。
- 证书报错只给「取消」和「这一次继续」，不给「永久信任」。对公信站点的证书异常，要么改系统时间，要么当下有人在中间——永久信任等于把后者变成常态。
- `allowBackup="false"`：系统备份不会把凭据带进另一个账号的设备。
- 登录状态只在用户点「退出」时删除（`CsStore.setSecret('cookie115','')`），应用不会把凭据发往任何第三方地址。

## 和桌面端比，这一版复现了多少

桌面端（`cloudsave-windows/`）的功能面是：5 个资源库站点 + 自定义分享源 + 盘搜、7 个网盘、
按网站与磁力两种监控、离线下载与逐集筛选、历史/导出/归档。手机端这轮把资源库从 1 个站点做到 3 个，
下面这张表是按模块名一条条对出来的，不是估计。

| 能力 | 桌面端 | 手机端 0.1.3 | 说明 |
| --- | --- | --- | --- |
| 115 分享链接转存（扫描/分片/逐项核验/取消） | ✅ | ✅ | 同一份 `share115-*.js`，语义逐条测过 |
| 115 登录（系统 WebView 读 Cookie）/ 手动粘贴 | ✅ | ✅ | 只在「转存」标签里需要 |
| 保存目录浏览与选择 | ✅ | ✅ | |
| 资源库：BT影视（分类/筛选/搜索/翻页/详情/磁力） | ✅ | ✅ | `btbtla-provider.js` 同一份，起手不落登录页 |
| 资源库：七味（分类/筛选/搜索/翻页/详情/磁力/网盘链接） | ✅ | ✅ | `qmp4-provider.js` 同一份；它的人机验证是「403 连着验证页一起回」，所以界面给「网站验证」按钮，走应用内那个网页 |
| 资源库：聚影（分类/标签/筛选/搜索/详情/磁力/网盘链接） | ✅ | ✅ | `jying-provider.js` + `jying-rate-limit.js` 同一份。列表与影片信息匿名可读，资源要登录；429/高频进冷静期后写进本机存储、到点前一次都不敲。它的接口层用了 `AbortSignal.timeout`（Chrome 97 起），所以这个站点按运行时能力判，不够就在站点选择器上写明「需 WebView 97 以上」而不是让请求挂掉 |
| 站点凭据（验证 Cookie、站点账号）按站点分键存 | ✅ | ✅ | 存在 `site:<id>` 的加密那间；115 那一份不受影响，也不会被串出去 |
| 应用内验证/登录窗（读该站点全部 Cookie + 指定的 localStorage） | ✅ | ✅ | 原生层只有一个窗口，回来的凭据按地址认领：`www.qmp4.com` 归七味、`jying.top` 归聚影、115 域名归转存面板 |
| 资源库：观影 | ✅ | ❌ | `guanying-provider.js` 只依赖已经打进包里的 `site-reader`，是下一个最省事的一个（先决条件是它的 HTML 解析在 WebView 里同样能跑） |
| 资源库：不太灵 | ✅ | ❌ | 它的目录抓取没有独立模块，逻辑在 `main.js` 的 `fetchCloudCatalog` 里（含镜像轮换、登录失效判定），要先抽成 provider 才谈得上接进手机 |
| 自定义分享源 | ✅ | ❌ | `custom-share115-provider.js` 本身没有依赖，但它连着桌面端的下载与归档文件层 |
| 盘搜（聚合搜索） | ✅ | ❌ | `haisou-renderer.js` 依赖桌面端多窗口 |
| 其它 6 个网盘（光鸭/123盘/夸克/天翼/迅雷/百度） | ✅ | ❌ | 只有 115 的公共层被抽成了可复用模块 |
| 磁力离线下载（提交到网盘离线） | ✅ | ❌ | 缺两块：`.torrent` 本体过不了文本桥；`crypto` 算 info_hash 无人提供（现在会明确报「只在桌面端」） |
| 网站监控 / 磁力监控（定时自动跑） | ✅ | ❌ | **结构性阻碍**：Android 上应用退到后台就没了，需要 WorkManager 或前台服务，不是把 JS 搬过去就行 |
| 「立即检查」手动监控（点开才跑一次） | ✅ | 可做 | 不需要后台能力，下一轮性价比最高的一项 |
| 转存历史、搜索、导出 XLSX、归档 | ✅ | ❌ | 桌面端靠 `json-writer`/`portable-storage` 等文件层，手机端只有 SharedPreferences + 私有目录 |
| 筛选条件界面（天数/大小/格式） | ✅ | ❌ | `share115-filters.js` 已经打进包里，只差界面 |
| 多账户、托盘、开机自启、远程页面 | ✅ | ❌ | 手机端不做 |

结论：**核心转存链路 + 5 个资源库站点里的 3 个已经复现，其余是「没接」而不是「接不了」**；
真正被平台卡住的只有「无人值守的定时监控」这一项。剩下两个站点各自卡在不同的地方：
观影缺一次「HTML 解析在 WebView 里跑过」的实测，不太灵缺一次把 `main.js` 里的目录逻辑抽成模块的重构——
后者在桌面端也是笔好账，做了两边都受益。

## 版本

| 版本 | 情况 |
| --- | --- |
| 0.1.0 / versionCode 1 | 首个独立版。**实机装上了、打不开**：首屏 `net::ERR_FILE_NOT_FOUND`，原因是上面第三条构建细节——apk 里 5 个 assets 条目名全是反斜杠。已废弃，别再装。 |
| 0.1.1 / versionCode 2 | 修掉 assets 条目名，并在构建里加了字节级门禁。**与 0.1.0 同一把签名密钥，直接覆盖安装即可，不用先卸载。** |
| 0.1.2 / versionCode 3 | 加「资源库」标签（BT影视，不登录就能浏览），页面起手落在这里，不再强制登录；打包清单从 4 个模块扩到 7 个；WebView 过旧判定改成不依赖 eval 的能力判据（门槛 92）；必需条目改为从 `index.html` 推导；换行归一 + 条目时间戳固定后，同一个提交可以逐字节复现重打。**同一把密钥，覆盖安装即可。** |
| 0.1.3 / versionCode 4 | 资源库从 1 个站点做到 3 个：七味与聚影的 provider 进了打包清单（7 → 10 个模块），界面上加了站点选择器和按站点现搭的筛选行；应用内那个网页窗口从「只能登 115」变成通用验证/登录窗，回来的凭据按地址认领、按站点分键存进加密那间，七味的验证 Cookie、聚影的账号、115 的登录态互不串。聚影按运行时能力登记（要 `AbortSignal.timeout`，即 WebView 97 以上），撞 429 进冷静期会把恢复时刻写进本机存储。**同一把密钥，覆盖安装即可。** |

## 验证状态：这台机器上没在真机跑过

我没有任何 Android 设备或模拟器（这台是 OpenStack 虚机，不支持嵌套虚拟化）。以下结论全是离线得到的：

- 发布签名构建通过；`apksigner verify -v` v1/v2/v3 为 true（v3.1 false，正常）；`zipalign -c -v 4` 通过；证书指纹还是那一个 `26a90120…`，所以 0.1.2 可以直接覆盖安装。
- 产物 `CloudSave-Standalone-0.1.3.apk`：140,540 字节，sha256 `06c36fb81817320587941924eed282f95c137b78e1ffa6ce20584b15ca05ccd4`。同一个目录里连着构建两次，两次的 sha256 相同（条目时间戳钉死这条还在管事）。
  说清楚边界：整包 sha 只在**同版本工具链**（d8/aapt2/JDK）下可比，换工具链大概率得到不同的包，所以给你的核对依据一直是「条目内容 + 包内版本 + 证书指纹」。0.1.2 那次还额外做过一份全新克隆、另一个目录、同一条命令的构建，结果逐字节相同；这条本轮补做，见下面「跨检出」那一句。
- `aapt2 dump badging`：包名、versionCode 4 / versionName 0.1.3、minSdk 23、targetSdk 34、只有 INTERNET、启动 Activity 正确。
- apk 条目名按字节读中央目录复核过（构建门禁之外又用独立脚本重读一遍）：**18 个条目，0 个反斜杠；`assets/www/` 7 个文件解压后 CRC 相符、与磁盘逐字节相同**。
- 门禁从 `index.html` 推导必需条目，本次报出 6 个引用（app.css + 5 个脚本）全部在包内。
- `classes.dex` 里 17 个类齐（比 0.1.2 多一个：`LoginActivity` 读站点 localStorage 那一跳的回调）。原生层这轮动了 `LoginActivity`、`NativeBridge`、`StandaloneActivity` 三个文件。
- JS 侧：`test-android-bundle.cjs`（三个站点的目录/详情、验证页与 401 翻成 `loginRequired`、冷静期落盘后不再敲网站、shim 有与无两条路、凭据按站点分键并按地址认领）、`test-android-preview.cjs`（测试台自身契约，含登录窗夹具）、`test-share115-api.cjs`，桌面全量 **153/153 通过，19 个因缺 electron 跳过**。
- 页面在真 Chromium 里对着真实站点跑过：BT影视 32 条、七味 42 条（详情 28 个种子 + 6 个网盘链接，「去转存」把链接和口令填进转存页并切了标签）、聚影 48 条（未登录的详情只给影片信息、不给资源）；按 `loginFor` 夹具走完聚影那条凭据链以后，三条 jying.top 请求各带 55 字节 Cookie，切回七味一条都不带，115 那间始终是空的；控制台无报错。**apk 里那 7 个文件与浏览器验过的磁盘文件逐字节相同**，所以这条验证是能算数的。

**必须由你在手机上实测的**：安装能否成功、首屏能否直接出资源库（这一版不该再要登录）、
三个站点在站点选择器里都能切动、列表与详情里的海报/磁力是否正常、七味那个「网站验证」按钮
打开的页面能不能真的过验证并把 Cookie 存回来、聚影那个「登录聚影」能不能读到它的登录态
（机型 WebView 低于 92 会提示升级，低于 97 时聚影那一项该写明「需 WebView 97 以上」而不是让请求挂在那里）、
切到「转存」标签后 115 登录窗能否读到 Cookie、
目录浏览、一次真实转存与核验、退出后凭据是否真删掉、返回键与切后台不崩。
出问题请把「运行日志」面板复制或截屏，同时给一下机型和 Android 版本。日志同时落在应用私有目录
`/data/data/ui.bwdd.cloudsave.standalone/files/cloudsave-phone.log`（超 512KB 自动截尾，保留后半 256KB），
普通文件管理器看不到这个路径，要读它得 `adb shell run-as ui.bwdd.cloudsave.standalone cat files/cloudsave-phone.log`；
日常排障直接用界面那个面板就行。
发布签名的包不给远程调试，只有 `.\build.ps1` 的调试版能配 `chrome://inspect` 看页面。

## 安装

1. apk 传到手机（文件管理器、`adb install` 都行）。
2. 点击安装，允许「未知来源」。自构建未上架，系统一定会警告一次。
3. 打开就是「资源库」：在 BT影视 / 七味 / 聚影 之间切着翻、搜、看磁力，不需要登录任何网盘。
   七味要过它自己的人机验证、聚影要看资源链接要登录站点，都在应用内那个网页里完成，凭据只留在这台手机上。
4. 要转存再点顶部「转存」→ 登录 115 → 选目录 → 粘贴分享链接 → 扫描 → 转存。
