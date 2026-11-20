#!/usr/bin/env bash
# 盘搜 APK 构建：aapt2 -> javac -> d8 -> 打包(assets + dex + 后端 so) -> zipalign -> apksigner
# 工具链复用 android-build/（JDK 17 + build-tools 35.0.1 + platform-35），不走 Gradle
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export JAVA_HOME="$HERE/../android-build/jdk"
BT="$HERE/../android-build/sdk/build-tools"
ANDROID_JAR="$HERE/../android-build/sdk/platforms-35/android.jar"
APP="$HERE/app"
OUT="$HERE/out"
SIGNED="$HERE/out/pansou.apk"
FINAL="$HERE/../pansou.apk"

export PATH="$JAVA_HOME/bin:$BT:$PATH"

[ -f "$ANDROID_JAR" ] || { echo "缺 android.jar：$ANDROID_JAR"; exit 1; }
[ -f "$HERE/bin/pansou.bin" ] || { echo "缺后端二进制：$HERE/bin/pansou.bin（从盒子 /data/adb/pansou/pansou 取出）"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/lib/arm64-v8a"

echo "==> 1/8 生成图标"
python "$HERE/make_icons.py" >/dev/null && echo "    图标 ok"

echo "==> 2/8 编译资源"
"$BT/aapt2.exe" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> 3/8 链接资源 / 清单 / assets"
"$BT/aapt2.exe" link \
  -o "$OUT/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$APP/assets" \
  --min-sdk-version 21 \
  --target-sdk-version 35 \
  --version-code 33 \
  --version-name "4.3" \
  "$OUT/res.zip"

echo "==> 4/8 编译 Java"
SRCS=$(find "$APP/src" -name "*.java")
"$JAVA_HOME/bin/javac" -encoding UTF-8 -source 8 -target 8 -nowarn \
  -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" \
  -d "$OUT/classes" $SRCS 2>&1 | grep -v "bootstrap class path\|source value 8\|target value 8\|To suppress warnings" || true
[ -f "$OUT/classes/com/maomao/pansou/MainActivity.class" ] || { echo "javac 失败"; exit 1; }

echo "==> 5/8 转 dex"
"$JAVA_HOME/bin/java" -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --lib "$ANDROID_JAR" --min-api 21 --output "$OUT/dex" \
  $(find "$OUT/classes" -name "*.class")

echo "==> 6/8 打包 dex + 后端二进制"
cp "$HERE/bin/pansou.bin" "$OUT/lib/arm64-v8a/libpansou.so"
cat > "$OUT/pack.py" <<'PY'
import sys, zipfile, shutil
src, dst, dex, so = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
shutil.copyfile(src, dst)
with zipfile.ZipFile(dst, 'a', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.write(dex, 'classes.dex')
    z.write(so, 'lib/arm64-v8a/libpansou.so')
print('packed ->', dst)
PY
python "$OUT/pack.py" "$OUT/base.apk" "$OUT/unsigned.apk" "$OUT/dex/classes.dex" "$OUT/lib/arm64-v8a/libpansou.so"

echo "==> 7/8 对齐"
"$BT/zipalign.exe" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "==> 8/8 签名"
KS="$HERE/pansou.keystore"
if [ ! -f "$KS" ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KS" \
    -storepass android -keypass android -alias pansou \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=PanSou, OU=Local, O=Local, L=Xinyang, ST=Henan, C=CN" >/dev/null 2>&1
  echo "    已生成签名证书"
fi

"$JAVA_HOME/bin/java" -jar "$BT/lib/apksigner.jar" sign \
  --ks "$KS" --ks-key-alias pansou \
  --ks-pass pass:android --key-pass pass:android \
  --out "$SIGNED" "$OUT/aligned.apk"

"$JAVA_HOME/bin/java" -jar "$BT/lib/apksigner.jar" verify --print-certs "$SIGNED" | head -4

cp "$SIGNED" "$FINAL"
echo
echo "APK -> $FINAL"
ls -lh "$FINAL" | awk '{print "大小:", $5}'
