package com.maomao.pansou;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 更新检查：问 GitHub 仓库「现在最新是哪个 Release」，跟本地版本比。
 *
 * 设计原则：
 *   - 只做只读 GET，不碰任何写接口。
 *   - 失败一律静默返回 null——更新提示是锦上添花，绝不能因为它让 App 起不来。
 *   - 版本用数字逐段比，避免 "v1.10" 被字符串比较当成小于 "v1.9"。
 */
final class UpdateChecker {

    /** 更新信息：线上 tag（如 v1.8）+ releases 页面地址 */
    static final class Info {
        final String tag;
        final String url;

        Info(String tag, String url) {
            this.tag = tag;
            this.url = url;
        }
    }

    private static final String API =
            "https://api.github.com/repos/lizy2020/PanSou-Android-Network-Disk-Search/releases/latest";
    static final String RELEASES =
            "https://github.com/lizy2020/PanSou-Android-Network-Disk-Search/releases";

    private static final Pattern TAG = Pattern.compile("\"tag_name\"\\s*:\\s*\"([^\"]+)\"");

    /**
     * 检查是否有更新。有则返回 Info，无更新或任何失败返回 null。
     * 必须在子线程调用（内含网络 IO）。
     */
    static Info check(String localVersion) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(API).openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/vnd.github+json");
            conn.setRequestProperty("User-Agent", "pansou-android-update-check");

            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) {
                android.util.Log.i("PansouUpdate", "HTTP " + code + "，跳过更新检查");
                return null;
            }

            String body = read(conn.getInputStream());
            Matcher m = TAG.matcher(body);
            if (!m.find()) {
                android.util.Log.i("PansouUpdate", "响应里没有 tag_name，跳过");
                return null;
            }
            String remote = m.group(1);
            android.util.Log.i("PansouUpdate", "线上=" + remote + " 本地=" + localVersion);

            if (compare(remote, localVersion) > 0) {
                return new Info(remote, RELEASES);
            }
            return null;
        } catch (Throwable e) {
            // 没网、超时、解析失败——都当「没有更新」，绝不打扰用户
            android.util.Log.i("PansouUpdate", "检查失败（静默）: " + e);
            return null;
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Throwable ignored) {}
            }
        }
    }

    private static String read(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        BufferedReader r = new BufferedReader(new InputStreamReader(in, Charset.forName("UTF-8")));
        String line;
        int n = 0;
        while ((line = r.readLine()) != null && n++ < 500) {
            sb.append(line).append('\n');
            // latest 端点只返回一个 release，读几千字节足够拿到 tag_name
            if (sb.length() > 200000) break;
        }
        try { r.close(); } catch (Throwable ignored) {}
        return sb.toString();
    }

    /**
     * 版本号逐段数字比较。忽略前导 v/V 和非数字后缀（如 -beta）。
     * 返回 >0 表示 a 比 b 新，<0 表示更旧，0 相等。
     */
    static int compare(String a, String b) {
        String[] x = norm(a).split("\\.");
        String[] y = norm(b).split("\\.");
        int n = Math.max(x.length, y.length);
        for (int i = 0; i < n; i++) {
            int xi = i < x.length ? num(x[i]) : 0;
            int yi = i < y.length ? num(y[i]) : 0;
            if (xi != yi) return xi < yi ? -1 : 1;
        }
        return 0;
    }

    private static String norm(String v) {
        if (v == null) return "";
        String s = v.trim();
        if (s.length() > 0 && (s.charAt(0) == 'v' || s.charAt(0) == 'V')) s = s.substring(1);
        return s;
    }

    private static int num(String seg) {
        int i = 0;
        while (i < seg.length() && Character.isDigit(seg.charAt(i))) i++;
        if (i == 0) return 0;
        try {
            return Integer.parseInt(seg.substring(0, i));
        } catch (Throwable e) {
            return 0;
        }
    }
}
