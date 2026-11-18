# NOTICE / 声明

## 1. 项目性质 · Nature of this project

本项目是上游 [fish2018/pansou](https://github.com/fish2018/pansou) 的**非官方 Android 移植版（fork）**。

它把上游的 Go 后端、Vue 前端与插件一起打包进一个 Android App，使手机在没有外部服务器的情况下即可运行 PanSou 搜索服务。

This is an **unofficial Android port (fork)** of the upstream project
[fish2018/pansou](https://github.com/fish2018/pansou). It bundles the upstream
Go backend, web frontend and plugins into a self-contained Android application,
so the search service runs entirely on the device without an external server.

本项目与上游作者无隶属关系，不代表上游官方立场。
This project is not affiliated with, endorsed by, or officially connected to
the upstream author.

## 2. 来源与版权 · Provenance and copyright

| 组成部分 Component | 来源 Source | 许可 License |
|---|---|---|
| Go 后端源码、插件、配置<br>Go backend source, plugins, config | [fish2018/pansou](https://github.com/fish2018/pansou) `main` 分支 | MIT © 2025 fish2018 |
| 编译后端二进制 `bin/pansou.bin`<br>Compiled backend binary | 由上述源码交叉编译（arm64） | MIT © 2025 fish2018 |
| Web 前端构建产物 `app/assets/www/`<br>Web frontend build | 上游 Vue 前端 | MIT © 2025 fish2018 |
| CA 证书 `app/assets/cacert.pem` | Mozilla CA Certificate Program | MPL 2.0 / Mozilla 条款 |
| Android 外壳、本地服务/代理、构建脚本<br>Android shell, local server/proxy, build script | 本项目原创 Original to this fork | MIT © 2026 lizy2020 |

完整的上游 MIT 许可文本见 [`docs/UPSTREAM-LICENSE.txt`](docs/UPSTREAM-LICENSE.txt) 与 [`LICENSE`](LICENSE)。

## 3. 非商业使用请求 · Non-commercial request

上游作者在仓库描述中明确写道：

> 仅供学习研究，请勿以各种形式用于盈利目的。

The upstream author states in the repository description:

> For study and research only; do not use it for any form of commercial profit.

该表述位于项目描述（非 MIT 许可正文），法律上不构成对 MIT 授权的限制；但作为派生项目，我们**尊重并转述上游意愿**：请仅将本项目用于个人学习与研究，勿用于任何盈利用途，亦勿以本项目名义收费、募捐或分发获利。

This statement appears in the project description (not the MIT license text) and
does not legally restrict the MIT grant. As a derivative work, we nevertheless
**respect and relay the upstream author's wish**: use this project only for
personal study and research, not for any commercial purpose, and do not charge,
solicit donations, or profit from distributing it under this project's name.

## 4. 免责声明 · Disclaimer

- 本项目按「现状」提供，不提供任何明示或暗示的保证。
- 本项目仅为技术学习与研究用途。使用者须自行判断并遵守其所在地区的法律法规。
- 本项目本身不存储、不上传、不提供任何资源文件；它只是一个在本机运行的搜索聚合工具，返回的是第三方站点/频道的公开链接。

- This project is provided "AS IS", without warranties of any kind.
- It is intended solely for technical study and research. Users are solely
  responsible for complying with applicable laws in their jurisdiction.
- This project does not host, upload, or serve any files. It is a local search
  aggregator that returns publicly available links from third-party sites and
  channels. The maintainers do not control, endorse, or verify any linked
  content, and assume no liability for how the software is used.

若你不认同上述条款，请勿下载或使用本项目。
If you do not agree with the above terms, do not download or use this project.

## 5. 安全说明 · Security note

原工程的签名私钥 `pansou.keystore` **未包含在本仓库中**。构建脚本会在缺失时自动生成一个新的开发用签名证书。因此，用源码自行构建的 APK 与 Release 中提供的预编译 APK **签名不同，无法覆盖安装**——升级前请先卸载旧版（会清除 App 内配置）。

The signing private key `pansou.keystore` is **deliberately not included** in this
repository. The build script generates a fresh development signing certificate
when none is present. Consequently, an APK built from source has a **different
signature** from the prebuilt Release APK and cannot be installed over it —
uninstall the old version first (this clears in-app settings).
