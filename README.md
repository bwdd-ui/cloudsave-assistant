# 云存助手 CloudSave Assistant

Windows x64 桌面工具，用于浏览影视资源、按条件采集磁力链接、监控网盘分享更新，以及将符合条件的资源保存到指定网盘文件夹。

本仓库包含 Windows 完整版、Docker x86-64 版与飞牛 NAS FPK 版。Windows 安装包包含 Electron 运行时，无需额外安装 Node.js；Docker 版可在 NAS 上独立运行，通过浏览器操作。Android 历史源码暂不包含在此仓库。

Docker 的安装、目录挂载及使用方式见 [Docker 使用说明](docker/README.md)。

飞牛 NAS x86-64 FPK 安装包见 [飞牛安装说明](fnos/README.md)，内置完整 Docker 镜像。

## 功能

- 不太灵、观影、BT影视、聚影、七味资源浏览，提供海报、详情、磁力与网盘资源分类、网站筛选及分页。
- 各网站独立的磁力监控和网盘分享监控，可同时运行多个任务，单独启停、保存筛选、保留断点。
- 磁力采集支持只扫描不提交，历史缓存可增量更新并导出 Excel。
- 电影与电视剧分别设置大小范围；电视剧合集可按单集大小判断，任何单集不符合条件时跳过合集。
- 网盘分享可设置目标文件夹、资源类型和筛选条件；同一目标网盘账号下，各资源库共享已保存链接历史，避免重复转存。
- 115 云下载实际状态缓存，支持全部同步建立基线、定时增量同步，以及磁力提交后触发增量更新。
- 123 云盘分享更新监控支持多个任务，每个分享链接分别指定目标文件夹。
- 自定义资源网站地址、账号登录窗口、Cookie 登录、镜像设置、运行日志及后台托盘运行。

115 与光鸭已有磁力和分享保存功能。新增的 123、夸克、天翼、迅雷、百度等适配按网盘能力开放；这些新增适配目前主要通过模拟接口测试，**尚未完成真实账号端到端转存验证，属于试运行功能**。自定义网站解析面向可读取的公开 HTML，具体兼容性取决于网站结构。

## 使用

1. 从本仓库 Releases 下载 Windows x64 EXE，放到可写目录后运行。
2. 在设置中打开对应网站或网盘的官方登录窗口；115 也可使用 Cookie 登录。
3. 选择保存文件夹，再启用所需的磁力或网盘监控任务。各功能可独立关闭。
4. 首次使用 115 状态对比时先执行全部同步，之后使用缓存和增量同步。

运行数据保存在 EXE 所在目录的 `Data` 中。升级前退出旧程序及托盘实例，将新版放在原目录沿用 Data；迁移到新目录时先备份再复制 Data。GitHub 发布包不包含任何用户的 Data、登录凭据或私人日志。

网站要求验证时需在官方窗口完成验证。聚影触发网站冷静期后会统一暂停该站网络请求、保留断点，并在到期后恢复已启用的监控；现有缓存仍可读取。

## 开发与构建

```powershell
cd cloudsave-windows
npm ci
npm start
```

构建 Windows x64 完整便携版本：

```powershell
npm run dist -- --x64
```

需要 Node.js、npm 及可下载 Electron 依赖的网络环境。依赖版本以 `package-lock.json` 为准。构建结果在 `cloudsave-windows/dist`。

运行主要回归测试：

```powershell
node tests/run-tests.cjs
```

测试使用模拟数据；部分 Electron UI 测试要求 Windows 图形环境和可写的 `C:\Temp`。请勿以真实账号测试代替模拟测试，避免意外提交资源。

## 开发资料

- [架构与移交说明](docs/ARCHITECTURE.md)
- [Windows 1.2.51 资源浏览缓存容错](docs/RELEASE-1.2.51.md)
- [Windows 1.2.26 网盘监控异常日期校验](docs/RELEASE-1.2.26.md)
- [Windows 1.2.25 相对日期筛选边界修复](docs/RELEASE-1.2.25.md)
- [Windows 1.2.24 读取超时清理异常保护](docs/RELEASE-1.2.24.md)
- [Windows 1.2.23 云下载同步计划竞态修复](docs/RELEASE-1.2.23.md)
- [Windows 1.2.22 筛选分页缓存容量修复](docs/RELEASE-1.2.22.md)
- [Windows 1.2.21 取消读取队列清理](docs/RELEASE-1.2.21.md)
- [Windows 1.2.20 资源缓存异常恢复](docs/RELEASE-1.2.20.md)
- [Windows 1.2.19 失败海报加载退避](docs/RELEASE-1.2.19.md)
- [Windows 1.2.18 资源库首次加载刷新优化](docs/RELEASE-1.2.18.md)
- [Windows 1.2.17 未提交记录状态修复](docs/RELEASE-1.2.17.md)
- [Windows 1.2.16 监控状态刷新减负](docs/RELEASE-1.2.16.md)
- [Windows 1.2.15 网盘监控旧任务调度恢复](docs/RELEASE-1.2.15.md)
- [Windows 1.2.14 分享监控停止边界修复](docs/RELEASE-1.2.14.md)
- [Windows 1.2.13 大目录转存核验提速](docs/RELEASE-1.2.13.md)
- [Windows 1.2.12 运行版本提示与重复启动保护](docs/RELEASE-1.2.12.md)
- [Windows 1.2.11 转存目录核验说明](docs/RELEASE-1.2.11.md)
- `cloudsave-windows` 中包含完整运行源码、锁定依赖清单、测试和各功能开发说明。
- Excel 列顺序：名称、资源大小、上映时间、磁力链接、磁力名称、时长、分辨率、帧率、视频、音频、类型、制片国家/地区。

本项目暂未指定开源许可，原项目许可标记为 `UNLICENSED`。源码公开供查看和交流；具体再分发授权需由作者另行明确。
