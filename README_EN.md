# PanSou for Android

> Unofficial Android port, based on [fish2018/pansou](https://github.com/fish2018/pansou) (MIT) · For study and research only
>
> 中文文档：[README.md](README.md)

PanSou for Android packages the [PanSou](https://github.com/fish2018/pansou) resource search service into a **self-contained Android app** — no external server required, install and run. In airplane mode everything works except Telegram channels.

This is a **fork** of the upstream project. The upstream Go backend source, plugins, configuration and web frontend are all included in this repository, except the signing private key (see [NOTICE.md](NOTICE.md)).

---

## Features

- **Fully self-contained**: frontend, Go backend and forwarding proxy all run on the device; no server deployment needed.
- **Multi-source concurrent search**: ~33 plugins / 22 channels built in, with smart result ranking and cloud-drive categorization.
- **Link availability check**: on by default, checks only the results currently visible on screen (a green dot indicates a check in progress), reducing CPU load and anti-bot risk.
- **Deep links to drive apps**: tapping a link opens the matching cloud-drive client (Quark, UC, etc.); falls back to the browser if not installed.
- **Persistent local settings**: channels, plugins, cloud-drive types and the detection toggle save on selection — no need to scroll to the bottom — and survive restarts.

## Current version

**v2.0** (versionCode 10) · package `com.maomao.pansou` · arm64 only · minSdk 21 / targetSdk 35

The prebuilt APK is at [`releases/pansou-android-v2.0.apk`](releases/pansou-android-v2.0.apk), also available on the GitHub Releases page.

## Changelog

- **v2.0** (versionCode 10)
  - Link detection is on by default and still checks only currently visible results; existing users who turned it off keep their choice.
- **v1.9**
  - Settings page: TG channels, search plugins, cloud-drive types and detection options all save on selection — the bottom save button is no longer needed.
- **v1.8**
  - Update hint: checks GitHub Releases in the background on startup and shows a red notice on the search page when a newer version exists, linking to the download page; fails silently.

## Quick start

1. Download and install the APK (Android 8.0+, arm64; allow "install from unknown sources").
2. On first launch, wait about 15 seconds for the bundled backend to initialize.
3. Type a keyword and tap the **paper-plane icon** at the right end of the input field to search (the top-right "Search" is a navigation item, not a button).
4. Tap the gear icon at top right for settings. Channels, plugins, cloud-drive types and the detection toggle all save on selection — no need to scroll to the bottom for a save button.

> **Telegram channels need a proxy**: without one, TG results are skipped automatically. Configure a system-level VPN/TUN, or set a local HTTP proxy in the app settings.

## Build from source

Requires **Windows + Git Bash + Python 3**. The toolchain (JDK 17 / build-tools 35 / platform 35 / adb) is not shipped with this repository; prepare it yourself and edit the path variables at the top of `build.sh` to point at your SDK:

```bash
export JAVA_HOME="/c/Program Files/Java/jdk-17"
BT="/c/Users/<you>/AppData/Local/Android/Sdk/build-tools/35.0.0"
ANDROID_JAR="/c/Users/<you>/AppData/Local/Android/Sdk/platforms/android-35/android.jar"
```

Then:

```bash
cd pansou-android
bash build.sh
```

Output is `../pansou.apk`. The script auto-generates a development signing certificate if `pansou.keystore` is absent.

> A self-built APK has a different signature from the prebuilt Release and cannot be installed over it — uninstall first. See [NOTICE.md](NOTICE.md) section 5.

For in-depth development notes, troubleshooting and known pitfalls, see [`docs/HANDOFF.zh-CN.md`](docs/HANDOFF.zh-CN.md) (Chinese).

## Repository layout

```
pansou-android/
├── README.md / README_EN.md     Docs in Chinese / English
├── LICENSE / NOTICE.md          License, provenance and disclaimer
├── build.sh                     Build script (aapt2 → javac → d8 → pack → align → sign)
├── make_icons.py                Icon generation
├── app/                         Android project
│   ├── src/com/maomao/pansou/   Java sources (6 files)
│   ├── assets/www/              Web frontend (upstream, incl. pansou-native.js injection)
│   └── assets/cacert.pem        CA certificates
├── bin/pansou.bin               Prebuilt arm64 Go backend (from upstream source)
├── upstream/                    Upstream sources bundled with this fork
│   ├── plugin/                  Plugin sources
│   └── config/                  Config sources
├── docs/                        Upstream license and developer handoff
└── releases/                    Prebuilt APK
```

Implementation notes: the Java-side `LocalProxy` works around the Go runtime failing to find `/etc/resolv.conf` on Android (Java resolves hostnames; Go connects to plain IPs only); `LocalServer` serves the static site and six-prefix reverse proxy on port 18887; `Prefs` + `pansou-native.js` provide settings persistence fallback.

## Provenance and license

This project is a fork of [fish2018/pansou](https://github.com/fish2018/pansou) under the upstream MIT License. Newly added Android shell code is also released under MIT. The upstream author requests "study and research only, no commercial use"; we respect and relay that wish. See [NOTICE.md](NOTICE.md) for full details.

**Disclaimer**: This project is for technical study and research only. It does not host, upload, or serve any files — it merely returns publicly available links from third-party sites. Users must comply with the laws of their jurisdiction and are solely responsible for how they use the software.
