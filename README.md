# 盘搜 Android 版 · PanSou for Android

> 非官方 Android 移植版 · 基于 [fish2018/pansou](https://github.com/fish2018/pansou)（MIT）· 仅供学习研究
>
> English documentation: [README_EN.md](README_EN.md)

把 [PanSou](https://github.com/fish2018/pansou) 网盘资源搜索服务打包成一个**自带后端的 Android App**：手机上不依赖任何外部服务器，安装即用。飞行模式下除 TG 频道外全部可用。

这是上游项目的 **fork**，上游的 Go 后端源码、插件、配置与 Web 前端均随本仓库附带，签名私钥除外（原因见 [NOTICE.md](NOTICE.md)）。

---

## 特性

- **完全离线自持**：App 内置前端、Go 后端与转发代理，无需部署服务器。
- **多源并发搜索**：内置约 33 个插件 / 22 个频道，结果智能排序与网盘类型分类。
- **链接可用性检测**：结果旁的绿点表示检测在进行。
- **外链唤起客户端**：点击网盘链接按域名唤起对应的网盘 App（夸克、UC 等），未安装则回退浏览器。
- **配置本地持久化**：设置与检测开关即时落盘，重启不丢。

## 当前版本

**v1.7**（versionCode 7）· 包名 `com.maomao.pansou` · 仅 arm64 · minSdk 21 / targetSdk 35

预编译 APK 位于 [`releases/pansou-android-v1.7.apk`](releases/pansou-android-v1.7.apk)，也可在 GitHub Releases 页下载。

## 快速开始

1. 下载并安装 APK（Android 8.0+，arm64 设备；允许「安装未知来源应用」）。
2. 首次启动等待约 15 秒，让内置后端完成初始化。
3. 在搜索框输入关键词，点击输入框右端的**纸飞机图标**发起搜索（右上角「搜索」是导航项，不是按钮）。
4. 右上角齿轮进入配置页；「检测」面板的开关点一下即自动保存，无需滚到页尾找保存按钮。

> **TG 频道需要代理**：无代理时程序会自动跳过 TG 结果。请在系统层面配置 VPN/TUN，或在 App 配置中填写本地 HTTP 代理。

## 从源码构建

需要 **Windows + Git Bash + Python 3**。工具链（JDK 17 / build-tools 35 / platform 35 / adb）未随本仓库发布，请自行准备，并修改 `build.sh` 顶部的路径变量指向你本机的 SDK：

```bash
export JAVA_HOME="/c/Program Files/Java/jdk-17"
BT="/c/Users/你的用户名/AppData/Local/Android/Sdk/build-tools/35.0.0"
ANDROID_JAR="/c/Users/你的用户名/AppData/Local/Android/Sdk/platforms/android-35/android.jar"
```

然后：

```bash
cd pansou-android
bash build.sh
```

产物为 `../pansou.apk`。脚本会在缺少 `pansou.keystore` 时自动生成开发用签名证书。

> 自构建 APK 与 Release 预编译版签名不同，无法覆盖安装；升级前请先卸载。详见 [NOTICE.md](NOTICE.md) 第 5 节。

更详细的开发说明、排错与踩坑记录见 [`docs/HANDOFF.zh-CN.md`](docs/HANDOFF.zh-CN.md)。

## 目录结构

```
pansou-android/
├── README.md / README_EN.md     中英文说明
├── LICENSE / NOTICE.md          许可、来源与免责声明
├── build.sh                     构建脚本（aapt2 → javac → d8 → 打包 → 对齐 → 签名）
├── make_icons.py                图标生成
├── app/                         Android 工程
│   ├── src/com/maomao/pansou/   Java 源码（6 个文件）
│   ├── assets/www/              Web 前端（上游，含 pansou-native.js 注入层）
│   └── assets/cacert.pem        CA 证书
├── bin/pansou.bin               编译好的 arm64 Go 后端（来自上游源码）
├── upstream/                    上游源码（随 fork 附带）
│   ├── plugin/                  插件源码
│   └── config/                  配置源码
├── docs/                        上游许可与开发交接文档
└── releases/                    预编译 APK
```

实现要点：Java 侧 `LocalProxy` 解决 Go 程序在 Android 上找不到 `/etc/resolv.conf` 导致 DNS 失败的问题（域名由 Java 解析，Go 只连纯 IP）；`LocalServer` 在 18887 端口提供静态站点与六前缀反代；`Prefs` + `pansou-native.js` 实现配置兜底。

## 来源与许可

本项目 fork 自 [fish2018/pansou](https://github.com/fish2018/pansou)，遵循上游 MIT 许可。新增的 Android 外壳部分同样以 MIT 发布。上游作者请求「仅供学习研究、勿用于盈利」，我们尊重并转述这一意愿。完整信息见 [NOTICE.md](NOTICE.md)。

**免责声明**：本项目仅供技术学习与研究。它不存储、不上传、不提供任何资源文件，仅返回第三方站点的公开链接。使用者须自行遵守所在地区法律法规，并对使用方式承担全部责任。
