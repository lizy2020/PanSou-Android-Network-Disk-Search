package com.maomao.pansou;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

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

    /** 只留前 120 字，日志里看个大概 */
    static String brief(String v) {
        if (v == null) return "null";
        return v.length() <= 120 ? v : v.substring(0, 120) + "…(" + v.length() + ")";
    }
}
