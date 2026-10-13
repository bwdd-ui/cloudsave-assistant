# 云存助手飞牛 NAS FPK x86-64

版本1.1.0，使用飞牛官方 fnpack 1.2.3 Docker 模板。FPK 内置已经通过 Docker 启动和持久化验证的 amd64 镜像；安装时导入本地镜像，不需要访问镜像仓库或自行编写 Compose。

## 安装

1. 在飞牛应用中心安装并启动 Docker。
2. 从 [FPK 发布页](https://github.com/bwdd-ui/cloudsave-assistant/releases/tag/v2026.10.13-fnos) 下载 `CloudSave-fnOS-x86-1.1.0.fpk`。
3. 在应用中心选择手动安装，选择 FPK，按向导设置浏览器管理用户名与密码。
4. 等待镜像导入及应用启动完成，再点击打开；也可访问 `https://NAS的IP:18985`。

管理密码不是网盘密码。进入软件后，在设置中打开各网站和网盘官方登录窗口。HTTPS 默认使用容器自签名证书；确认地址属于自己的 NAS 后处理证书提示，也可以配置自己的证书。关闭浏览器后，已启用的监控仍运行。

仅支持 Intel/AMD x86-64，不支持 ARM 或32位 x86。包声明安装到系统分区；请保证应用安装与 Docker 存储位置有足够空间，建议预留至少3 GB。

## 数据和更新

应用标识保持 `cloudsave`，运行数据继续存放在飞牛应用的 `var` 目录，程序 Data 位于 `var/Data`。升级脚本不删除 Data、账号会话、监控任务和历史。Excel 保存对话框选择 `/output`，对应飞牛共享目录 `cloudsave/exports`，也可通过管理界面的文件管理器下载。

旧 FPK 如可正常安装，可直接升级到1.1.0。旧管理登录配置会尝试迁移；如果旧密码包含本版向导不支持的字符，请在升级向导设置新管理密码。管理密码更新不更改业务 Data。卸载仍由飞牛系统管理，卸载前请备份应用数据和共享导出目录。

Windows/Docker 数据迁移：停止两端程序并备份，将自己的完整 Data（含 portable-key.bin）复制到本应用 `var/Data`，不覆盖现有数据。部分跨系统浏览器会话可能需要重新登录。

## 构建及验证范围

安装脚本、向导和官方清单在 `fnos/cloudsave`。构建前将本项目 Docker Release 的 `CloudSave-Docker-amd64-20261013.tar.gz` 放到 `app/docker`。`python3 fnos/build.py` 会验证镜像哈希、必要配置和 UTF-8/LF 格式，然后调用官方 fnpack。GitHub Actions 还检查 Linux 脚本语法、安装/升级/配置回调、镜像导入和实际容器运行。

当前没有连接真实飞牛 NAS，不能代替应用中心实机安装验证。发布包经过官方打包器和容器验证，飞牛系统版本、共享目录权限及桌面入口仍需在用户设备上确认。遇到错误请提供应用中心显示的完整安装提示。

官方格式参考：[Docker 应用案例](https://developer.fnnas.com/docs/examples/docker/) 和 [fnpack](https://developer.fnnas.com/docs/cli/fnpack/)。
