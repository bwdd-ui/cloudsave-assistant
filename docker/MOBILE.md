# 用手机操作云存助手

手机访问的仍然是容器里那套完整界面，只是把容器的虚拟显示改窄，让 `mobile.css` 的窄屏规则生效：侧栏变成顶部横滑导航，海报两列、按钮加大、弹窗贴底。监控、转存、日志、导出全部复用现有逻辑，数据依旧存在 `./config`。

这不是原生安卓 App：没有推送、没有离线，关闭手机只是断开画面，容器里的任务照常运行。

## 一、开启手机档位

编辑 `docker/.env`：

```sh
CLOUDSAVE_PASSWORD=你的管理密码
DISPLAY_WIDTH=420
DISPLAY_HEIGHT=900
CLOUDSAVE_MOBILE_LAYOUT=1
```

重建容器（改显示分辨率必须重建，`restart` 不生效）：

```sh
docker compose up -d --force-recreate
docker compose logs --tail=60
```

`CLOUDSAVE_MOBILE_LAYOUT=1` 的作用：桌面档位的窗口最小宽度是 1100，窄显示区会被这个下限顶回去，窄屏样式永远不会触发。开启后窗口下限放宽到 320x480 并铺满显示区，同时收起顶部的中文菜单栏（420px 宽放不下）。若显示区本身宽度已不足 1100，程序会自动进入手机档位，这个开关只是用来强制。

## 二、手机上添加入口

1. 手机浏览器打开 `https://NAS的IP:5800`，用 `admin` 和 `CLOUDSAVE_PASSWORD` 登录。自签名证书会提示风险，先确认地址是你自己的 NAS。
2. 竖屏使用建议锁定手机自动旋转；浏览器菜单里关掉“桌面站点”。
3. Chrome / Edge 菜单 → **添加到主屏幕**（部分机型显示为“安装应用”）。以后从图标进入，登录后直接是应用画面。

## 三、觉得字太小或太大

改 `DISPLAY_WIDTH` 再重建容器，值越大整屏内容缩得越小（画面被缩放到手机屏幕宽度）：

| DISPLAY_WIDTH | 效果 |
| --- | --- |
| 380–460 | 最推荐，两列海报，字最大 |
| 460–560 | 仍是手机档，海报依旧两列，一屏内容更多 |
| 561–899 | 平板档：保留左侧栏，但按钮已按触控放大 |
| 900 以上 | 桌面档，手机上基本点不准 |

noVNC 页面自己的工具栏里还有“缩放桌面 / 1:1”开关，优先用浏览器的自适应缩放。

## 四、首次登录请在电脑上完成

各站点的登录窗口加载的是第三方网页（115、观影、聚影、123、光鸭等），它们在 420px 宽度下并不好操作。手机档位会把这些窗口收窄到显示区宽度，但页面本身没有手机版式。建议：先用电脑（`DISPLAY_WIDTH=1600`）把各站点登录、验证、筛选条件配置好，会话保存在 `./config`；之后把容器改成手机档位，手机上只做浏览、点转存、看日志。

需要人机验证时，仍要本人完成。

## 五、想同时保留电脑档和手机档

不要起两个容器共用同一个 `./config`：两份程序会互相覆盖配置、登录会话和历史记录，监控还会重复执行同一批转存。要么改分辨率重建（推荐，一次改动 30 秒），要么真的复制第二套服务并使用独立的 `config` 目录、独立端口，且只在其中一套开启监控。

## 六、已知限制

- 画面是远程桌面的帧流，走蜂窝网络会比较慢且耗流量，建议在 Wi-Fi 下使用；跨网访问请自行配好反向代理或内网穿透，不要把 5800 直接暴露到公网。
- “添加到主屏幕”的图标和标题由基础镜像的网页客户端决定，本应用无法提供自己的 PWA manifest 和图标——这是走界面适配路线的代价。
- 手机输入法弹出会遮住页面底部；弹窗已改成贴底抽屉、按钮常驻可见，仍被挡住时先用键盘上方的回车提交。
- 触屏拖动即滚动，长列表用顶部导航切换页面，不用左右滑动手势。

## 七、验证状态

仓库测试（`node tests/run-tests.cjs`）覆盖：手机档位只在窄显示区或显式开关下生效、登录窗跟随收窄、`mobile.css` 排在其他样式表之后、以及窄屏规则用到的每个类名在界面上真实存在。

`docker/smoke.cjs` 在 `CLOUDSAVE_MOBILE_LAYOUT=1` 时会对真实渲染结果追加断言：`body` 纵向堆叠、顶部导航高度 ≥44px、海报两列、侧栏收起按钮已隐藏、视口宽度 ≤560，结果一并写进 `/config/docker-smoke.json`。手动跑一次：

```sh
docker run --rm --shm-size=1g \
  -e CLOUDSAVE_SMOKE_TEST=1 -e WEB_AUTHENTICATION_PASSWORD=临时密码 \
  -e DISPLAY_WIDTH=420 -e DISPLAY_HEIGHT=900 -e CLOUDSAVE_MOBILE_LAYOUT=1 \
  -v "$PWD/mobile-smoke-data:/config" cloudsave-assistant:1.2.1
# 约一分钟后查看 mobile-smoke-data/docker-smoke.json 与 docker-smoke.png
```

把这条检查加进 CI 的补丁已经放在仓库里（`docker/ci-mobile-profile.patch`，给 `docker-amd64.yml` 增加一步“再起一次手机档容器并上传 `mobile-smoke.json`”）。它没有随本轮一起改工作流文件，因为 GitHub 不允许没有 `workflow` 权限的令牌推送工作流改动。想启用时本地执行：

```sh
git apply docker/ci-mobile-profile.patch
git add .github/workflows/docker-amd64.yml && git commit && git push
```

真机手感——手指点按是否准确、输入法遮挡、蜂窝网络流畅度——只能在手机上确认。

