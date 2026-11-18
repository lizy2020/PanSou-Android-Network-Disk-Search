package com.maomao.pansou;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int BG = 0xFF0E1116;
    private static final int FG = 0xFFE6EDF3;
    private static final int DIM = 0xFF8B98A5;

    private WebView web;
    private FrameLayout root;
    private LinearLayout overlay;
    private TextView status;
    private TextView detail;
    private ProgressBar spinner;
    private Button retry;

    private LocalServer server;
    private Backend backend;
    private String origin;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 35) {
            // 35 起状态栏/导航栏颜色接口已废弃，窗口默认铺满全屏、系统栏透明，
            // 由 applyInsets() 负责内容避让；系统栏图标用手白色，配深色底。
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        } else if (Build.VERSION.SDK_INT >= 21) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            getWindow().setStatusBarColor(BG);
            getWindow().setNavigationBarColor(BG);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);

        web = new WebView(this);
        configureWeb();
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        buildOverlay();
        root.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        applyInsets();
        boot();
    }

    // ------------------------------------------------------------ WebView

    /**
     * 前端保存配置时把值交回原生。注入脚本里叫 PansouNative.put(k, v)。
     * 只接受白名单里的键，避免任意页面把无关数据写进来。
     */
    private class CfgBridge {
        @android.webkit.JavascriptInterface
        public void put(String key, String value) {
            if (!Prefs.isCfgKey(key)) return;
            Prefs.putCfg(MainActivity.this, key, value);
            android.util.Log.i("PansouCfg", "原生已备份 " + key + " = " + Prefs.brief(value));
        }
    }

    private void configureWeb() {
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        web.addJavascriptInterface(new CfgBridge(), "PansouNative");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
                // 前端 console 全量进 logcat：出错时不用连电脑开 devtools
                android.util.Log.i("PansouWeb", "[" + m.messageLevel() + "] " + m.message());
                return true;
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return routeUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (Build.VERSION.SDK_INT >= 21) {
                    return routeUrl(req.getUrl().toString());
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideOverlay();
                logWebConfig();
            }
        });
    }

    /**
     * 把前端存着的配置打到 logcat（只取 pansou_ 开头的配置项，不碰 auth_token）。
     * 用途：判断「保存了却变回去」到底是没写进去、还是写进了另一个 origin。
     */
    private void logWebConfig() {
        StringBuilder keys = new StringBuilder();
        for (int i = 0; i < Prefs.CFG_KEYS.length; i++) {
            if (i > 0) keys.append(',');
            keys.append('\'').append(Prefs.CFG_KEYS[i]).append('\'');
        }
        final String js = "try{var o={};[" + keys + "].forEach(function(k){var v=localStorage.getItem(k);"
                + "if(v!==null)o[k]=v.length>120?v.slice(0,120)+'...('+v.length+')':v});"
                + "'origin='+location.origin+' cfg='+JSON.stringify(o)}catch(e){'ERR:'+e}";
        web.evaluateJavascript(js, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                android.util.Log.i("PansouWeb", v == null ? "null" : v);
            }
        });
        android.util.Log.i("PansouCfg", "原生备份快照 = " + Prefs.cfgSnapshot(this));
    }

    /** 本地页面自己消化；外部链接交给系统浏览器（夸克/115 之类才有对应 App 接管） */
    private boolean routeUrl(String url) {
        if (url == null) return false;
        if (origin != null && url.startsWith(origin)) return false;
        if (url.startsWith("http://127.0.0.1") || url.startsWith("file://")) return false;

        Uri uri;
        try {
            uri = Uri.parse(url);
        } catch (Throwable e) {
            return true;
        }

        // 1) 网盘分享链接：指名交给对应的网盘客户端，跳过系统浏览器的选择。
        //    客户端没装、或者它本身不接这种外链（百度网盘就不接任意 https），
        //    解析不到就静默交回系统，不弹误导性提示。
        String pkg = diskAppFor(uri.getHost());
        if (pkg != null) {
            Intent app = new Intent(Intent.ACTION_VIEW, uri);
            app.setPackage(pkg);
            app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (getPackageManager().resolveActivity(app, 0) != null) {
                try {
                    startActivity(app);
                    android.util.Log.i("PansouRoute", "外链交给客户端: " + uri.getHost() + " -> " + pkg);
                    return true;
                } catch (Throwable ignored) {
                }
            }
            android.util.Log.i("PansouRoute", "客户端不接此链接，交回系统: " + uri.getHost() + " -> " + pkg);
        }

        // 2) 其余外链（夸克/115 之类没装客户端时也走这里）交给系统
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Throwable ignored) {
        }
        return true;
    }

    /**
     * 已知网盘域名 → 首选客户端包名。只映射确实是网盘分享的域名，避免把普通网页
     * 也塞进某个 App。没有对应客户端时返回 null，调用方退回系统默认。
     */
    private static String diskAppFor(String host) {
        if (host == null) return null;
        String h = host.toLowerCase(Locale.US);
        if (h.startsWith("www.")) h = h.substring(4);
        if (h.equals("pan.quark.cn") || h.equals("drive.uc.cn")) {
            return "com.quark.browser";
        }
        if (h.equals("pan.baidu.com") || h.equals("eyun.baidu.com") || h.equals("yun.baidu.com")) {
            return "com.baidu.netdisk";
        }
        if (h.equals("alipan.com") || h.endsWith(".alipan.com")
                || h.equals("aliyundrive.com") || h.endsWith(".aliyundrive.com")) {
            return "com.alicloud.databox";
        }
        if (h.equals("pan.xunlei.com")) {
            return "com.xunlei.downloadprovider";
        }
        if (h.equals("115.com") || h.endsWith(".115.com")
                || h.equals("115cdn.com") || h.endsWith(".115cdn.com")) {
            return "com.115.personal";
        }
        if (h.equals("caiyun.139.com")) {
            return "com.chinamobile.mcloud";
        }
        if (h.equals("123pan.com") || h.endsWith(".123pan.com") || h.equals("123684.com")) {
            return "com.123pan";
        }
        if (h.equals("mypikpak.com") || h.endsWith(".mypikpak.com")) {
            return "com.pikcloud.pikpak";
        }
        return null;
    }

    // ------------------------------------------------------------ 遮罩

    private void buildOverlay() {
        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setGravity(android.view.Gravity.CENTER);
        overlay.setBackgroundColor(BG);
        overlay.setPadding(dp(28), dp(28), dp(28), dp(28));

        spinner = new ProgressBar(this);
        overlay.addView(spinner, new LinearLayout.LayoutParams(dp(40), dp(40)));

        status = new TextView(this);
        status.setTextColor(FG);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        status.setGravity(android.view.Gravity.CENTER);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(18);
        overlay.addView(status, slp);

        detail = new TextView(this);
        detail.setTextColor(DIM);
        detail.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        detail.setTypeface(Typeface.MONOSPACE);
        detail.setVisibility(View.GONE);
        ScrollView box = new ScrollView(this);
        box.setVisibility(View.GONE);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(220));
        blp.topMargin = dp(16);
        box.addView(detail);
        overlay.addView(box, blp);
        detailBox = box;

        retry = new Button(this);
        retry.setText("重试");
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                boot();
            }
        });
        LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rlp.topMargin = dp(20);
        overlay.addView(retry, rlp);
    }

    private ScrollView detailBox;

    private void setStatus(final String text) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                overlay.setVisibility(View.VISIBLE);
                spinner.setVisibility(View.VISIBLE);
                retry.setVisibility(View.GONE);
                detailBox.setVisibility(View.GONE);
                status.setText(text);
            }
        });
    }

    private void fail(final String title, final String log) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                overlay.setVisibility(View.VISIBLE);
                spinner.setVisibility(View.GONE);
                retry.setVisibility(View.VISIBLE);
                status.setText(title);
                detail.setText(log == null ? "" : log);
                detailBox.setVisibility(View.VISIBLE);
            }
        });
    }

    private void hideOverlay() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                overlay.setVisibility(View.GONE);
            }
        });
    }

    // ------------------------------------------------------------ 启动

    private void boot() {
        setStatus("正在准备运行环境…");
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    backend = Backend.get(MainActivity.this);

                    if (backend.isHealthy()) {
                        setStatus("正在连接已有搜索服务…");
                    } else {
                        setStatus("正在启动搜索服务…");
                        backend.start();
                        setStatus("等待搜索服务就绪…");
                        if (!backend.waitReady(35000)) {
                            fail("搜索服务没能起来", "进程存活：" + backend.alive() + "\n\n" + backend.tailLog(40));
                            return;
                        }
                    }

                    if (server == null) {
                        server = LocalServer.obtain(getAssets(), Backend.PORT);
                        int p = server.start();
                        origin = "http://127.0.0.1:" + p;
                    }
                    // 注入脚本据此回填 localStorage。用实时来源，保证每次刷新拿到的都是最新值
                    server.setCfgSource(new LocalServer.CfgSource() {
                        @Override
                        public String snapshot() {
                            return Prefs.cfgSnapshot(MainActivity.this);
                        }
                    });

                    setStatus("正在加载界面…");
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            web.loadUrl(origin + "/");
                        }
                    });
                } catch (final Throwable e) {
                    fail("启动出错", String.valueOf(e) + "\n\n"
                            + (backend != null ? backend.tailLog(30) : ""));
                }
            }
        }, "boot");
        t.setDaemon(true);
        t.start();
    }

    /**
     * Android 15（targetSdk 35）起系统强制 edge-to-edge：窗口铺满全屏、系统栏透明，
     * 内容必须自己避让，否则会被状态栏或手势条盖住。
     *
     * API 30+ 用 WindowInsets.Type 取 insets——旧的 getSystemWindowInsetXxx 在 35 上
     * 已废弃，也不包含刘海等新分区；低版本保留旧接口。
     * 底部同时取 ime：有的 ROM 在 edge-to-edge 下不缩窗口，只发 ime inset。
     */
    private void applyInsets() {
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                int top;
                int bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    int[] tb = InsetsCompat.systemBars(insets);
                    top = tb[0];
                    bottom = tb[1];
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                if (v.getPaddingTop() != top || v.getPaddingBottom() != bottom) {
                    v.setPadding(0, top, 0, bottom);
                }
                return insets;
            }
        });
    }

    // ------------------------------------------------------------ 交互

    @Override
    public void onBackPressed() {
        if (overlay.getVisibility() == View.VISIBLE) return;
        new AlertDialog.Builder(this)
                .setTitle("盘搜")
                .setItems(new String[]{"设置", "刷新页面", "清空搜索缓存", "退出"}, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        if (which == 0) showSettings();
                        else if (which == 1) web.reload();
                        else if (which == 2) clearCache();
                        else shutdown();
                    }
                })
                .show();
    }

    private void showSettings() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(16), dp(20), dp(4));

        TextView label = new TextView(this);
        label.setTextColor(FG);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        label.setText("出站代理（TG 频道需要）");
        box.addView(label);

        final EditText et = new EditText(this);
        et.setHint("http://127.0.0.1:7890");
        et.setText(Prefs.proxy(this));
        et.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        et.setTextColor(FG);
        et.setHintTextColor(DIM);
        box.addView(et);

        TextView hint = new TextView(this);
        hint.setTextColor(DIM);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        hint.setText("留空＝直连。手机上的代理若是 VPN/TUN 模式，Go 的流量本来就走隧道，这里也留空。\n"
                + "只有代理开在本地 HTTP 端口（如 Clash 7890）时才需要填。");
        LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        hlp.topMargin = dp(10);
        box.addView(hint, hlp);

        AlertDialog dlg = new AlertDialog.Builder(this)
                .setTitle("设置")
                .setView(box)
                .setPositiveButton("保存并重启服务", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        Prefs.setProxy(MainActivity.this, et.getText().toString());
                        restartBackend();
                    }
                })
                .setNeutralButton("查看日志", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        showLog();
                    }
                })
                .setNegativeButton("取消", null)
                .create();
        dlg.show();
        // 别一打开就弹键盘，挡掉半屏说明文字
        if (dlg.getWindow() != null) {
            dlg.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);
        }
    }

    private void showLog() {
        final TextView tv = new TextView(this);
        tv.setTextColor(FG);
        tv.setTypeface(Typeface.MONOSPACE);
        tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
        tv.setText(backend == null ? "（未启动）" : backend.tailLog(300));
        ScrollView sv = new ScrollView(this);
        sv.addView(tv);
        sv.setPadding(dp(12), dp(8), dp(12), dp(8));

        new AlertDialog.Builder(this)
                .setTitle("运行日志")
                .setView(sv)
                .setPositiveButton("关闭", null)
                .show();
    }

    private void restartBackend() {
        setStatus("正在重启搜索服务…");
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (backend == null) backend = Backend.get(MainActivity.this);
                    backend.stop();
                    backend.start();
                    if (!backend.waitReady(35000)) {
                        fail("搜索服务没能起来", backend.tailLog(40));
                        return;
                    }
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            hideOverlay();
                            web.reload();
                            Toast.makeText(MainActivity.this, "服务已重启", Toast.LENGTH_SHORT).show();
                        }
                    });
                } catch (final Throwable e) {
                    fail("重启失败", String.valueOf(e) + "\n\n" + (backend != null ? backend.tailLog(30) : ""));
                }
            }
        }, "restart");
        t.setDaemon(true);
        t.start();
    }

    private void clearCache() {
        File cache = new File(backend == null ? getFilesDir() : backend.workDir(), "cache");
        int n = 0;
        File[] fs = cache.listFiles();
        if (fs != null) {
            for (File f : fs) {
                if (deleteTree(f)) n++;
            }
        }
        Toast.makeText(this, "已清理 " + n + " 项缓存，建议重启服务", Toast.LENGTH_SHORT).show();
    }

    private static boolean deleteTree(File f) {
        if (f.isDirectory()) {
            File[] cs = f.listFiles();
            if (cs != null) for (File c : cs) deleteTree(c);
        }
        return f.delete();
    }

    private void shutdown() {
        try {
            if (server != null) server.stop();
            if (backend != null) backend.stop();
        } catch (Throwable ignored) {}
        finish();
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) {
            try {
                if (server != null) server.stop();
                if (backend != null) backend.stop();
            } catch (Throwable ignored) {}
        }
        super.onDestroy();
    }

    private int dp(int v) {
        return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
    }
}
