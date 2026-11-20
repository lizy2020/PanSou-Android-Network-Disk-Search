package com.maomao.pansou;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * 运行时配置。默认值取自盒子上跑通的那一套（/data/adb/pansou/config.env + plugins.conf）。
 * 只在设置里改代理时才会写入 SharedPreferences。
 *
 * 另有一块 cfg_* 区域：前端把设置存在 WebView 的 localStorage 里，而 localStorage
 * 是按「协议+域名+端口」分区的，端口一变、缓存一清，用户保存的设置就读不到了
 * （表现为「保存后重启又变回默认」）。这里给几项关键配置留一份原生副本，
 * 页面加载时回填、保存时回写，让设置不依赖 WebView 的存储。
 */
final class Prefs {

    private static final String SP = "pansou";

    /** 33 个插件，全部编译在二进制里，这里只给名字 */
    static final String PLUGINS =
            "488run,5266ys,btbtlb,clmao,clxiong,diduan,duoduo,dygang,erxiaopan,haitunsou,hjzhencai,"
            + "huban,hunhepan,ikantv,jutoushe,kpkuang,leso,libvio,lou1,meitizy,melost,miosou,muou,"
            + "quarksoo,shandian,susu,xiaokupan,xiaoyu,xiaozhang,yingso,yunso,zhizhen,zxzj";

    /** 22 个 TG 频道，需要代理才能通 */
    static final String CHANNELS =
            "tgsearchers4,Aliyun_4K_Movies,yunpanxunlei,BaiduCloudDisk,tianyifc,gotopan,PanjClub,"
            + "shareAliyun,Quark_Movies,dianyingshare,ucwpzy,alyp_1,xx123pan,tyypzhpd,tianyirigeng,"
            + "cloudtianyi,Lsp115,Channel_Shares_115,vip115hot,yunpan139,pikpakpan,yoyokuakeduanju";

    /** 需要原生备份的前端配置键。只挑设置项，检测结果缓存那种高频写入的不在此列 */
    static final String[] CFG_KEYS = {
            "pansou_detection_settings",
            "pansou_disk_types",
            "pansou_plugins",
            "pansou_channels",
            "pansou_custom_channels",
            "pansou_export_settings"
    };

    private static final String CFG_PREFIX = "cfg_";

    private Prefs() {}

    private static SharedPreferences sp(Context c) {
        return c.getApplicationContext().getSharedPreferences(SP, Context.MODE_PRIVATE);
    }

    /** 出站代理，形如 http://127.0.0.1:7890；留空表示直连 */
    static String proxy(Context c) {
        return sp(c).getString("proxy", "");
    }

    static void setProxy(Context c, String v) {
        sp(c).edit().putString("proxy", v == null ? "" : v.trim()).commit();
    }

    // ------------------------------------------------------------ 前端配置副本

    static boolean isCfgKey(String key) {
        if (key == null) return false;
        for (String k : CFG_KEYS) {
            if (k.equals(key)) return true;
        }
        return false;
    }

    static void putCfg(Context c, String key, String value) {
        if (!isCfgKey(key)) return;
        if (value == null) {
            sp(c).edit().remove(CFG_PREFIX + key).commit();
        } else {
            sp(c).edit().putString(CFG_PREFIX + key, value).commit();
        }
    }

    /** 打成 {"key":"value"} 形式的字面量，直接嵌进页面。没有备份时返回 {} */
    static String cfgSnapshot(Context c) {
        SharedPreferences p = sp(c);
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (String k : CFG_KEYS) {
            String v = p.getString(CFG_PREFIX + k, null);
            if (v == null) continue;
            if (!first) sb.append(',');
            first = false;
            sb.append(JSONObject.quote(k)).append(':').append(JSONObject.quote(v));
        }
        return sb.append('}').toString();
    }

    // ------------------------------------------------------------ 壁纸
    // 自定义图不再塞进 SharedPreferences。dataURL 动辄 1~2MB，写进 XML 后每次
    // commit 都是一次几 MB 的同步落盘，慢到可能超时或被系统打断 —— 表现出来
    // 就是「选完当场生效，重启又变回旧图」（内存里是新值，磁盘上还是旧值）。
    // 现在图片按字节写应用私有文件，SP 只留类型、透明度和「有自定义图」标记，
    // 每次 commit 只有几百字节。

    private static final String WP_TYPE    = "wp_type";      // builtin / custom
    private static final String WP_VALUE   = "wp_value";     // 内置渐变 id
    private static final String WP_ALPHA   = "wp_alpha";     // 搜索框通透度 0~1
    private static final String WP_HAS_IMG = "wp_has_img";   // 自定义图已经在文件里
    private static final String WP_CUSTOM  = "wp_custom";    // 旧版本存的大 dataURL，只用于迁移

    private static File customImage(Context c) {
        return new File(c.getApplicationContext().getFilesDir(), "wp_custom.jpg");
    }

    private static float clampAlpha(float a) {
        if (a < 0f) return 0f;
        if (a > 1f) return 1f;
        return a;
    }

    /** dataURL → 字节写文件。先写 .tmp 再改名，半截文件永远不会被读到 */
    static boolean saveCustomImage(Context c, String dataUrl) {
        if (dataUrl == null) return false;
        int comma = dataUrl.indexOf(',');
        if (comma <= 0 || !dataUrl.startsWith("data:image")) {
            Log.w("PansouWallpaper", "不是合法的图片 dataURL");
            return false;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
        } catch (Throwable e) {
            Log.w("PansouWallpaper", "dataURL 解码失败: " + e);
            return false;
        }
        File f = customImage(c);
        File tmp = new File(f.getAbsolutePath() + ".tmp");
        FileOutputStream os = null;
        try {
            os = new FileOutputStream(tmp);
            os.write(bytes);
            os.flush();
            os.getFD().sync();
            os.close();
            os = null;
            if (f.exists() && !f.delete()) {
                Log.w("PansouWallpaper", "旧壁纸文件删不掉，可能被占用");
            }
            if (!tmp.renameTo(f)) {
                Log.e("PansouWallpaper", "壁纸文件改名失败 " + tmp + " -> " + f);
                return false;
            }
            Log.i("PansouWallpaper", "壁纸已写入文件 " + bytes.length + " 字节");
            return true;
        } catch (Throwable e) {
            Log.e("PansouWallpaper", "写壁纸文件失败: " + e);
            return false;
        } finally {
            if (os != null) {
                try { os.close(); } catch (Throwable ignored) {}
            }
        }
    }

    static String customImageDataUrl(Context c) {
        File f = customImage(c);
        if (!f.exists() || f.length() <= 0) return "";
        try {
            byte[] b = new byte[(int) f.length()];
            FileInputStream in = new FileInputStream(f);
            try {
                int off = 0;
                while (off < b.length) {
                    int n = in.read(b, off, b.length - off);
                    if (n <= 0) break;
                    off += n;
                }
            } finally {
                in.close();
            }
            return "data:image/jpeg;base64," + Base64.encodeToString(b, Base64.NO_WRAP);
        } catch (Throwable e) {
            Log.e("PansouWallpaper", "读壁纸文件失败: " + e);
            return "";
        }
    }

    static float wallpaperAlpha(Context c) {
        return sp(c).getFloat(WP_ALPHA, 0.5f);
    }

    static boolean hasCustomImage(Context c) {
        return sp(c).getBoolean(WP_HAS_IMG, false) || customImage(c).exists();
    }

    static void setBuiltinWallpaper(Context c, String id, float alpha) {
        if (id == null || id.length() == 0) id = "aurora";
        boolean ok = sp(c).edit()
                .putString(WP_TYPE, "builtin")
                .putString(WP_VALUE, id)
                .putFloat(WP_ALPHA, clampAlpha(alpha))
                .commit();
        if (!ok) Log.w("PansouWallpaper", "内置壁纸配置写入失败");
    }

    /** 自定义图：图片落文件，SP 只记几百字节的标记 */
    static boolean setCustomWallpaper(Context c, String dataUrl, float alpha) {
        boolean saved = saveCustomImage(c, dataUrl);
        SharedPreferences.Editor e = sp(c).edit()
                .putString(WP_TYPE, "custom")
                .putFloat(WP_ALPHA, clampAlpha(alpha));
        if (saved) {
            e.putBoolean(WP_HAS_IMG, true);
            // 旧版本把整张图存在 wp_value / wp_custom 里，一并清掉，XML 才不会被撑到几 MB
            e.putString(WP_VALUE, "aurora");
            e.remove(WP_CUSTOM);
        }
        boolean committed = e.commit();
        if (!committed) Log.e("PansouWallpaper", "壁纸配置 commit 失败");
        return saved;
    }

    /** 只改通透度：滑块高频调用，不能每次都重写图片文件 */
    static void setWallpaperAlpha(Context c, float alpha) {
        boolean ok = sp(c).edit().putFloat(WP_ALPHA, clampAlpha(alpha)).commit();
        if (!ok) Log.w("PansouWallpaper", "通透度写入失败");
    }

    /** 切回已记住的自定义图（不重新读图，前端自己套用） */
    static void applyCustomWallpaper(Context c, float alpha) {
        if (!hasCustomImage(c)) {
            Log.w("PansouWallpaper", "没有可用的自定义图");
            return;
        }
        sp(c).edit()
                .putString(WP_TYPE, "custom")
                .putBoolean(WP_HAS_IMG, true)
                .putFloat(WP_ALPHA, clampAlpha(alpha))
                .commit();
    }

    /** 返回 {"type","value","alpha","custom","hasCustom"}，供 JS Bridge 同步读取 */
    static String wallpaperConfig(Context c) {
        SharedPreferences p = sp(c);
        String type = p.getString(WP_TYPE, "builtin");
        String value = p.getString(WP_VALUE, "aurora");
        float alpha = p.getFloat(WP_ALPHA, 0.5f);

        // 迁移旧版本：以前自定义图以超大 dataURL 存在 SP 里，第一次启动搬到文件
        if (!p.getBoolean(WP_HAS_IMG, false)) {
            String legacy = p.getString(WP_CUSTOM, "");
            if ((legacy == null || legacy.length() == 0)
                    && value != null && value.startsWith("data:image")) {
                legacy = value;
            }
            if (legacy != null && legacy.startsWith("data:image") && saveCustomImage(c, legacy)) {
                p.edit()
                        .putBoolean(WP_HAS_IMG, true)
                        .remove(WP_CUSTOM)
                        .putString(WP_VALUE, "aurora")
                        .commit();
                Log.i("PansouWallpaper", "旧壁纸已迁移到文件存储");
            }
        }

        String custom = customImageDataUrl(c);
        if ("custom".equals(type) && custom.length() == 0) {
            // 图片文件丢了就回落内置，别让用户对着纯色发呆
            type = "builtin";
            value = "aurora";
        }
        if ("custom".equals(type)) value = custom;

        JSONObject o = new JSONObject();
        try {
            o.put("type", type);
            o.put("value", value);
            o.put("alpha", alpha);
            o.put("custom", custom);
            o.put("hasCustom", custom.length() > 0);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /** 只留前 120 字，日志里看个大概 */
    static String brief(String v) {
        if (v == null) return "null";
        return v.length() <= 120 ? v : v.substring(0, 120) + "…(" + v.length() + ")";
    }
}
