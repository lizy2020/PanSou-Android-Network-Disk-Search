# 盘搜 APK · 开发交接包

最后更新：2026-11-15　当前版本：**v1.7（versionCode 7）**

---

## 一、这是什么

把部署在盒子上的 [pansou](https://github.com/fish2018/pansou) 打包成**自带后端的安卓 App**。手机上不依赖任何外部服务器，飞行模式下除 TG 频道外全部可用。

App 内部结构：

```
WebView (Vue 前端)
   ↓ http://127.0.0.1:18887
内置静态站点 + 反向代理 (LocalServer)
   ↓ 127.0.0.1:18888
Go 后端 pansou（libpansou.so，arm64）
   ↓ http://127.0.0.1:18889
内置转发代理 (LocalProxy) —— 由 Java 做 DNS 解析，绕开 Go 在 Android 上的解析缺陷
   ↓
外网
```

### 端口分配（改动前务必确认没撞）

| 端口 | 用途 | 固定性 |
|---|---|---|
| 18887 | 前端静态站点 + 六前缀反代 | 固定，App 内单例，绑不上才退随机 |
| 18888 | Go 后端 API | 固定，`Backend.PORT` |
| 18889 | 内置 HTTP 转发代理 | 固定，`LocalProxy` |

**18887 必须固定**：WebView 的 localStorage 按「协议+域名+端口」分区，端口一变，用户配置全部读不到。

---

## 二、目录结构

```
pansou-handoff/
├── README.md                  本文件
├── pansou.apk                 已构建好的 v1.7，可直接安装
├── pansou-apk/                ★ 工程源码，主战场
│   ├── build.sh               构建脚本（aapt2 → javac → d8 → 打包 → 对齐 → 签名）
│   ├── pansou.keystore        签名证书，口令均为 android，别名 pansou
│   ├── make_icons.py          图标生成（改图标后由 build.sh 自动调用）
│   ├── app/
│   │   ├── AndroidManifest.xml
│   │   ├── src/com/maomao/pansou/     Java 源码，见第四节
│   │   ├── res/                       图标与主题资源
│   │   └── assets/
│   │       ├── www/                   前端站点（Vue 打包产物，651K）
│   │       │   ├── index.html
│   │       │   ├── assets/index-Cq3OwTOt.js
│   │       │   └── pansou-native.js   ★ 注入脚本，配置兜底的核心
│   │       └── cacert.pem             CA 证书，给 Go 用
│   └── bin/pansou.bin          Go 后端二进制，arm64，24MB
├── android-build/             工具链（已精简，可直接用）
│   ├── jdk/                   OpenJDK 17.0.2，完整
│   ├── sdk/
│   │   ├── build-tools/       aapt2 / zipalign / d8.jar / apksigner.jar
│   │   └── platforms-35/      android.jar（API 35）
│   └── platform-tools/        adb.exe 及其依赖 dll
├── diag/                      本地复现前端问题用的脚本，见第六节
└── memory/                    记忆文件（MEMORY.md + 逐月日志），别丢
```

已从原工程剔除：`out/`（构建中间产物）、`android-build` 里另外两个无关项目（todo 系列）、`platforms-35/data`（89MB，构建用不到）。

---

## 三、新机器上怎么跑起来

### 环境要求

- Windows 10/11
- **Git Bash**（`build.sh` 是 bash 脚本，cmd/PowerShell 直接跑会失败）
- **Python 3**（`build.sh` 里生成图标与打包 dex 用到）
- 不需要 Gradle、Android Studio、Android SDK 环境变量；adb 也已附带

工具链已随包附带，`build.sh` 用的是相对路径 `$HERE/../android-build/`，**解压后保持现有目录结构，不要单独移动 `pansou-apk/`**。

### 构建

```bash
cd pansou-apk
bash build.sh
```

产物落在 `pansou-apk/../pansou.apk`（即包根目录），同时保留一份 `pansou-apk/out/pansou.apk`。

脚本八步：生成图标 → `aapt2 compile` 资源 → `aapt2 link` 生成 base.apk → `javac` → `d8` 转 dex → 打包 dex 与 so → `zipalign -p 4` → `apksigner`。

**改版本号**：编辑 `build.sh` 里 `--version-code` 与 `--version-name` 两个参数，两处都要改。

### 安装到手机

手机开 USB 调试，插线，用包内自带的 adb（无需另装 SDK）：

```bash
./android-build/platform-tools/adb.exe devices
./android-build/platform-tools/adb.exe install -r pansou.apk
```

若嫌路径长，先加进 PATH：

```bash
export PATH="$PWD/android-build/platform-tools:$PATH"
adb devices
```

首次连接需在手机上确认「允许 USB 调试」。

签名证书与原机一致（SHA-256 `a2f9c784…`），可直接覆盖安装，用户数据不丢。若换证书，必须先卸载，届时 App 内的配置会一起清掉。

### 若新机器已有 JDK 17 和 Android SDK

不必带 296MB 的 jdk 目录，改 `build.sh` 顶部三行即可：

```bash
export JAVA_HOME="/c/Program Files/Java/jdk-17"     # 或任意 JDK 17+
BT="/c/Users/你的用户名/AppData/Local/Android/Sdk/build-tools/35.0.0"
ANDROID_JAR="/c/Users/你的用户名/AppData/Local/Android/Sdk/platforms/android-35/android.jar"
```

注意 `build-tools` 必须 ≥ 35，`javac` 必须 17（用 8 编译会报 bootclasspath 错）。

---

## 四、源码地图

`app/src/com/maomao/pansou/` 共六个文件。

### MainActivity.java
界面与 WebView 配置。要点：

- `configureWeb()`：开 JS、DOM Storage、Database，`MIXED_CONTENT_ALWAYS_ALLOW`。
- `startAll()`：起 LocalProxy → 起 Backend → 起 LocalServer → `web.loadUrl(origin)`。
- `logWebConfig()`：把 origin 与关键配置打到 logcat（TAG `PansouWeb`），排「配置丢了」第一现场。
- `routeUrl()`：拦外链，按域名映射包名唤起网盘客户端。`pan.quark.cn` / `drive.uc.cn` → `com.quark.browser` 等。**先 `resolveActivity` 探测，探不到就静默回退给浏览器**，不能盲发 Intent（百度网盘不接任意 https，会 crash）。
- `applyInsets()`：Android 15 edge-to-edge 适配，靠 `InsetsCompat` 隔离 `android.graphics.Insets`。
- `onBackPressed` → `web.goBack()`；清单里设了 `enableOnBackInvokedCallback="false"`，避免 Android 13+ 预测性返回抢事件。

### Backend.java
拉起 Go 进程。要点：

- 启动前注入环境变量：`HTTP_PROXY` / `HTTPS_PROXY` 指向 18889，`NO_PROXY=127.0.0.1,localhost,::1`，`SSL_CERT_FILE` 指向 cacert，`TMPDIR` 指向 App 私有目录。
- 启动前扫 `/proc` 清理同 uid 残留后端进程（否则新实例绑不上 18888，界面却显示正常，极难查）。
- 健康检查**强制 `Proxy.NO_PROXY`**，否则 127.0.0.1 的请求会绕出去。
- 日志镜像到 logcat，TAG `PansouBackend`。

### LocalServer.java
内置 HTTP 服务。要点：

- 绑 18887，失败重试 8 次后兜底随机（正常不会走到）。
- `obtain()` 进程内单例，`start()` 幂等 —— 防旋转屏幕/重建 Activity 时起两个站点。
- 六前缀反代：`/api`、`/qqpd`、`/gying`、`/panlian`、`/weibo`、`/woniu`。
- 返回 `/index.html` 时把 `assets/www/pansou-native.js` 内联进 `<head>`，占位符替换成原生配置快照。位置必须在第一个 `<script type="module">` 之前 —— module 是 defer 语义，内联脚本先跑，Vue 挂载时读到的已是回填后的值。

### LocalProxy.java
本地转发代理，解决**本项目最要命的一个坑**：`GOOS=linux` 编译的 Go 程序在 Android 上找不到 `/etc/resolv.conf`，DNS 回退到 `127.0.0.1:53` / `[::1]:53`，全部 `connection refused`。表现是 App 能开、能出界面，但搜索零结果。

解法：Go 只连纯 IP（走 HTTP_PROXY 到 18889），域名解析交给 Java 的 `InetAddress.getByName()`。支持 CONNECT 隧道，正确处理 IPv6 `[::]` authority。

### Prefs.java
SharedPreferences 封装。存六个 `pansou_*` 配置键的原生副本（内部加 `cfg_` 前缀）加一个「已播种」标志，供配置兜底使用。

### InsetsCompat.java
隔离类。`android.graphics.Insets` 是 API 29+ 才有的，低版本加载会类校验失败，必须单独放一个类里做版本判断，不能在主类直接引用。

### assets/www/pansou-native.js
注入脚本，配置持久化的核心。规则三条：

1. **单向补齐**：localStorage 里没有的键，才用原生快照补。
2. **本地优先**：本地有值，就以本地为准，并回写原生。
3. **绝不反向覆盖**：拿旧备份盖新值会导致「保存完一刷新又变回去」，这是写这段代码时先避掉的坑。

另外对 `#detection-toggle` 做了 `document` 捕获阶段的 `change` 委托 —— 检测开关一点就落盘，用户不必滚到页面最底部找「保存配置」按钮（v1.7 新增，见第七节）。

---

## 五、验证清单

装完照这个表走，全过才算好。

| # | 操作 | 期望 |
|---|---|---|
| 1 | 冷启动等 15s | 界面正常，无白屏 |
| 2 | `adb logcat -s PansouBackend` | `health: 33 plugins / 22 channels / tg.reachable` |
| 3 | 搜 `movie` | 有结果，右侧绿点表示链接检测在跑 |
| 4 | 点外链（夸克） | 日志 `外链交给客户端: pan.quark.cn -> com.quark.browser`，跳原生网盘 |
| 5 | 配置页改网盘类型，保存，杀进程重开 | 改动保留 |
| 6 | 检测开关打开/关闭，**不点保存**，杀进程重开 | 双向都保留 |
| 7 | Android 15 上：状态栏不遮内容、键盘不压输入框、返回键回上一页 | 正常 |
| 8 | `unzip -l pansou.apk` 查 `lib/arm64-v8a/libpansou.so` 对齐 | `zipalign -c -p 4` 通过（16KB 页要求） |

杀进程用 `adb shell am force-stop com.maomao.pansou`，比划掉最近任务更彻底。

---

## 六、排错

### 日志出口

| TAG | 来源 |
|---|---|
| `PansouWeb` | 前端 console 全量转发 + `logWebConfig` 的 origin/配置快照 |
| `PansouBackend` | Go 进程 stdout/stderr |
| `PansouCfg` | 原生配置备份写入 |

```bash
adb logcat -c && adb logcat -s PansouWeb:* PansouCfg:* PansouBackend:*
```

前端所有 `console.log` 都会进 logcat，真机排错不需要连 devtools。

### 界面元素定位

这个 WebView **`uiautomator dump` 拿不到节点**，只能按像素点。当前机型（OPPO PGZ110，1080×2412，density 480）实测坐标：

| 元素 | 坐标 |
|---|---|
| 顶部搜索按钮 | (683, 213) |
| 齿轮（配置） | (815, 213) |
| 配置页 tab 栏 | y = 1268，右滑 `input swipe 950 1268 300 1268 300` |
| 「检测」tab | (679, 1268) |
| 检测开关 | (793, 1689) |
| 「保存配置」（页尾） | (540, 2124)，需先 `input swipe 540 1900 540 900 400` |

元素找不到时用 PIL 扫像素找连通块（顶部蓝色按钮就是这么定位的），比猜坐标可靠。

### 本地复现前端问题

`diag/` 里的脚本可直接用，把前端当纯静态站点跑起来，比在手机上试错快得多：

```bash
cd diag
npm i                      # 只为 playwright，浏览器用本机已有的
node server.js 18887       # 静态服务 + /api 桩
node repro.js              # 走完「进配置→切检测→开开关→保存→reload」
node test-inject.js        # 注入脚本四个场景单测
node server2.js 18890      # 带注入的版本，配 e2e.js 做端到端
```

Playwright 若报浏览器版本不匹配，用 `executablePath` 指向本机 `ms-playwright/chromium-*/chrome-win/chrome.exe`。

**这一步的价值**：能立刻分清「逻辑错」还是「存储没留住」。前者改 JS，后者要做兜底，两种修法完全不同。

---

## 七、踩过的坑（改代码前先读）

1. **Go 的 DNS** —— 见第四节 `LocalProxy`。这是「界面能开但搜不到」的唯一根因，别再往网络权限、防火墙方向查。
2. **localStorage 按 origin 分区** —— 端口漂移等于换了个存储空间。18887 固定是硬要求。
3. **保存按钮藏在页尾** —— 检测面板下面一大片空白，不滚到底看不见「保存配置」。v1.6 之前用户以为点了开关就生效，实际没存。v1.7 改为开关即时落盘，但仍要留意其他面板是否存在同类问题。
4. **`pkill -f "\./p"` 会误杀** —— 在盒子上调试时匹配过宽，把别的东西杀了，Magisk watchdog 两秒自动拉回。别用宽松的进程名匹配。
5. **CRLF 叠加** —— Windows 的 `adb shell` 会把 `\n` 变 `\r\n`，再叠一层成 `\r\r\n`，HTTP 头畸形。手工发 HTTP 时用单个 `\n`。
6. **`printf` 吃 `%`** —— 传含 `%E7` 的 URL 会被当格式符，用 `printf '%s\n'` 逐行传参。
7. **旧进程占端口** —— 新实例绑不上 18888 但界面看着正常。已在 `Backend` 里加 `/proc` 清理，改这块时别删。
8. **aapt2 拒绝数字开头的包名段** —— `<queries>` 里不能写 `com.115.personal`，改用 `<intent>` 形式声明。
9. **百度网盘不接任意 https** —— 显式指名包会 `unable to resolve`，必须 `resolveActivity` 探测后静默回退。
10. **OPPO 锁屏断 adb** —— 调试前 `adb shell svc power stayon usb`、`settings put system screen_off_timeout 1800000`。
11. **截图发灰** —— 息屏前的 DimLayer 被截进去，`input keyevent KEYCODE_WAKEUP` 后恢复。
12. **16KB 页对齐** —— Android 15 要求 `libpansou.so` 按 16KB 对齐，`zipalign -p 4` 的 `-p` 不能省。

---

## 八、可选后续

- targetSdk 升到 36
- adaptive icon（当前是传统 mipmap 五套尺寸）
- 改 AAB + 上架签名（当前是自签名）
- `bin/pansou.bin` 只编译了 arm64，如需 32 位或 x86 得重新交叉编译 Go

---

## 九、别丢的东西

- `pansou-apk/pansou.keystore` —— 丢了就无法覆盖升级，用户配置全部作废。口令 `android`。
- `pansou-apk/bin/pansou.bin` —— 从盒子 `/data/adb/pansou/pansou` 取出，是后端本体。若需重新编译，源码在上游仓库，交叉编译参数 `GOOS=android GOARCH=arm64 CGO_ENABLED=0`。
- `memory/` —— 逐月日志里有完整的排查过程和结论，比代码注释详细。
