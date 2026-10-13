# 云存助手 Docker x86-64

适用于飞牛 NAS、群晖、Linux 服务器等支持 Docker 的 Intel/AMD 64 位设备，架构为 `linux/amd64`。保留完整 Electron 界面，由服务器独立登录、扫描和保存，通过浏览器操作。关闭浏览器不会停止监控。不是 32 位 x86 或 ARM 镜像。

## 安装

在 [Docker 发布页](https://github.com/bwdd-ui/cloudsave-assistant/releases/tag/v1.2.1-docker) 下载镜像 `CloudSave-Docker-amd64-1.2.1.tar.gz` 和部署资料 `CloudSave-Docker-Deploy-1.2.1.tar.gz`。通过 NAS 的 Docker 镜像导入界面导入镜像，或在服务器终端执行：

```sh
mkdir -p cloudsave && cd cloudsave
docker load -i /下载路径/CloudSave-Docker-amd64-1.2.1.tar.gz
tar xzf /下载路径/CloudSave-Docker-Deploy-1.2.1.tar.gz
cp .env.example .env
```

编辑 `.env`，填写自己设置的 `CLOUDSAVE_PASSWORD`（管理界面的密码，不是网盘密码），根据目录权限修改 `USER_ID`、`GROUP_ID`。然后启动：

```sh
docker compose up -d
```

浏览器访问 **`https://NAS的IP:5800`**，用户名默认 `admin`，密码为 `.env` 中设置的密码。容器默认生成自签名 HTTPS 证书，也可以配置自己的证书或受信任反向代理。自签名证书可能显示证书提示，请先确认地址是自己的 NAS。

飞牛图形界面也可新建 Compose 项目，粘贴 compose.yaml，设置环境变量并将两个目录映射到自己的硬盘目录。无需特权模式，无需挂载 Docker socket，也不需要宿主机桌面。

## 持久数据和导出

| 宿主机目录 | 容器目录 | 用途 |
| --- | --- | --- |
| `./config` | `/config` | 配置、登录会话、本地历史和缓存；程序数据位于 `/config/Data` |
| `./output` | `/output` | Excel 导出和下载文件，可通过浏览器工具栏文件管理器下载 |

导出 Excel 的保存对话框选择 `/output`。这里是容器本地文件路径；网盘的目标保存目录仍需在软件中选择网盘文件夹。

首次启动在设置中打开网站/网盘登录窗口，窗口会显示在同一浏览器桌面内。升级后保留整个 `config` 目录，不需要重新创建任务。需要网站验证时仍需本人完成验证。

迁移 Windows 数据：先退出旧程序并备份，将自己的完整 `Data` 复制为 `config/Data`，包括 portable-key.bin，切勿覆盖已有数据。业务记录及便携加密字段可以迁移；Chromium 跨操作系统的部分会话 Cookie 可能需要重新登录。不要在两套正在运行的程序之间共享同一个 Data。

## 更新和停止

导入新镜像后沿用挂载目录重新创建容器：

```sh
docker compose up -d --force-recreate
docker compose logs --tail=100
docker compose stop
```

停止时给予 90 秒保存缓存，不要直接强制终止。备份时先停止容器，再备份 `config` 和 `output`。删除容器不会删除这两个宿主目录。

## 从源码构建

在仓库根目录执行：

```sh
docker build --platform linux/amd64 -f docker/Dockerfile -t cloudsave-assistant:1.2.1 .
cd docker
cp .env.example .env
# 设置密码后执行
docker compose up -d
```

镜像使用锁定版本的 Electron Linux 运行时和 [jlesage 图形容器基础镜像](https://github.com/jlesage/docker-baseimage-gui)，通过其浏览器桌面、HTTPS 登录和文件管理器提供访问。默认 Docker 限制与 Chromium 嵌套沙箱不兼容，因此 Electron 使用 `--no-sandbox`，由非 root 应用用户和容器边界隔离；请只挂载必要的数据目录，管理端口用于自己的可信网络。

建议至少 2 GB 可用内存、2 GB 可用镜像磁盘空间。完整运行时与图形环境使 Docker 镜像大于 Windows EXE。网盘适配的试运行状态与 Windows 版本一致，容器验证不会对真实网盘执行转存。
