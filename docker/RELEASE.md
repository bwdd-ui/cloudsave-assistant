# 1.2.0 Docker x86-64 优化版

Linux amd64 容器优化版：改善数据写入故障恢复、缓存页刷新退避、115账号切换同步和七味监控取消；海报按可见范围加载并支持键盘操作。完整变更见源码 docs/RELEASE-1.2.0.md。

- 配置和登录会话持久挂载到 `/config/Data`，导出文件保存到 `/output`。
- 管理界面要求设置密码，默认 HTTPS，不公开 VNC 端口。
- 容器停止信号触发程序原有缓存保存流程。
- Docker 上真实启动 Electron、检查资源导航和 IPC 桥、非 root 运行、持久配置及重启后测试 Cookie。

下载镜像 tar.gz，通过 Docker 镜像导入或 `docker load -i` 导入；下载 Deploy 部署包，设置 .env 中的密码后执行 `docker compose up -d`。访问 `https://NAS的IP:5800`。

完整安装与迁移说明见源码 docker/README.md。Docker 测试仅使用独立的测试目录及合成 Cookie；新增网盘真实账号适配仍为试运行状态。
