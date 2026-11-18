package com.maomao.pansou;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * 内置的 pansou 后端进程管理。
 *
 * 关键点：Android 10+ 禁止执行应用数据目录里的文件，所以二进制必须以
 * lib/arm64-v8a/libpansou.so 的形式随包安装，安装器会把它解到 nativeLibraryDir，
 * 那个目录是允许 execve 的（这也是唯一不需要 root 的落点）。
 */
final class Backend {

    private static final String TAG = "PansouBackend";

    static final int PORT = 18888;

    /** 内置转发代理端口，避开常见端口 */
    static final int PROXY_PORT = 18889;

    private static Backend INSTANCE;

    private final Context app;
    private Process proc;
    private File logFile;
    private File workDir;

    private Backend(Context c) {
        this.app = c.getApplicationContext();
    }

    static synchronized Backend get(Context c) {
        if (INSTANCE == null) INSTANCE = new Backend(c);
        return INSTANCE;
    }

    File workDir() {
        if (workDir == null) {
            workDir = new File(app.getFilesDir(), "pansou");
            if (!workDir.exists()) workDir.mkdirs();
        }
        return workDir;
    }

    private File logFile() {
        if (logFile == null) logFile = new File(workDir(), "pansou.log");
        return logFile;
    }

    /** 已经在跑（本进程起的，或上一次遗留的孤儿进程） */
    boolean isHealthy() {
        return probe(900);
    }

    private boolean probe(int timeoutMs) {
        HttpURLConnection c = null;
        try {
            URL u = new URL("http://127.0.0.1:" + PORT + "/api/health");
            // 必须绕开系统代理：手机开着 Clash 时，默认 ProxySelector 可能把
            // 本机回环也塞进代理，健康检查会假失败
            c = (HttpURLConnection) u.openConnection(java.net.Proxy.NO_PROXY);
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs);
            c.setRequestProperty("Connection", "close");
            return c.getResponseCode() == 200;
        } catch (Throwable t) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * 启动后端。已健康则直接复用（例如 Activity 重建、或孤儿进程）。
     */
    synchronized void start() throws Exception {
        if (probe(700)) return;

        // 端口在监听却不应答 = 上一轮遗留的僵尸后端占着 18888，新实例根本绑不上。
        // 不清理的话 App 看起来正常、实际一次都搜不到。同 uid 的进程可以直接杀掉。
        killStaleBackend();
        Thread.sleep(300);

        File dir = workDir();
        File cache = new File(dir, "cache");
        if (!cache.exists()) cache.mkdirs();

        File ca = new File(dir, "cacert.pem");
        copyAsset("cacert.pem", ca);

        String libDir = app.getApplicationInfo().nativeLibraryDir;
        File bin = new File(libDir, "libpansou.so");
        if (!bin.exists()) {
            throw new IOException("内置后端缺失（本机 ABI 可能不是 arm64）：" + bin.getAbsolutePath());
        }
        if (!bin.canExecute() && !bin.setExecutable(true, false)) {
            throw new IOException("后端文件无法置为可执行：" + bin.getAbsolutePath());
        }

        // 清掉上一轮的日志，避免越滚越大
        try {
            if (logFile().length() > 512 * 1024) new FileOutputStream(logFile()).close();
        } catch (Throwable ignored) {}

        ProcessBuilder pb = new ProcessBuilder(bin.getAbsolutePath());
        pb.directory(dir);
        Map<String, String> env = pb.environment();
        env.remove("LD_PRELOAD");
        env.remove("LD_LIBRARY_PATH");

        env.put("PORT", String.valueOf(PORT));
        env.put("TMPDIR", dir.getAbsolutePath());
        // Android 没有 /etc/ssl/certs/ca-certificates.crt，Go 出站 TLS 会直接报
        // "certificate signed by unknown authority"，必须显式指定 CA 包
        env.put("SSL_CERT_FILE", ca.getAbsolutePath());

        env.put("CACHE_ENABLED", "true");
        env.put("CACHE_PATH", cache.getAbsolutePath());
        env.put("CACHE_TTL", "120");

        env.put("ENABLED_PLUGINS", Prefs.PLUGINS);
        env.put("CHANNELS", Prefs.CHANNELS);

        env.put("CONCURRENCY", "40");
        env.put("ASYNC_RESPONSE_TIMEOUT", "2");
        env.put("ASYNC_MAX_BACKGROUND_WORKERS", "48");
        env.put("PLUGIN_BATCH_TIMEOUT_SECONDS", "3");
        env.put("PLUGIN_SJF_ENABLED", "true");
        env.put("TG_CHANNEL_TIMEOUT_SECONDS", "3");
        env.put("TG_CHANNEL_REQUEST_TIMEOUT_SECONDS", "4");
        env.put("TG_BACKFILL_ENABLED", "true");

        String proxy = Prefs.proxy(app);
        if (proxy.length() > 0) {
            // 用户手工指定了代理（通常是 Clash 的 HTTP 端口）：直接用，
            // 由那个代理负责解析域名
            env.put("HTTP_PROXY", proxy);
            env.put("HTTPS_PROXY", proxy);
            env.put("NO_PROXY", "127.0.0.1,localhost,::1");
            android.util.Log.i(TAG, "使用用户指定代理: " + proxy);
        } else {
            // 交给本机转发代理解析域名（详见 LocalProxy 的注释）
            int pport = LocalProxy.get().start(PROXY_PORT);
            String local = "http://127.0.0.1:" + pport;
            env.put("HTTP_PROXY", local);
            env.put("HTTPS_PROXY", local);
            env.remove("ALL_PROXY");
            env.put("NO_PROXY", "127.0.0.1,localhost,::1");
            android.util.Log.i(TAG, "使用内置转发代理: " + local);
        }

        pb.redirectErrorStream(true);
        proc = pb.start();
        pump(proc.getInputStream());
    }

    /** 等后端把 18888 挂起来 */
    boolean waitReady(long timeoutMs) {
        long end = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < end) {
            if (probe(700)) return true;
            if (proc != null && !proc.isAlive()) return false;   // 已退出，别干等了
            try {
                Thread.sleep(250);
            } catch (InterruptedException e) {
                return false;
            }
        }
        return probe(700);
    }

    synchronized void stop() {
        if (proc != null) {
            try {
                proc.destroy();
                for (int i = 0; i < 20 && proc.isAlive(); i++) Thread.sleep(50);
                if (proc.isAlive()) proc.destroyForcibly();
            } catch (Throwable ignored) {
            }
            proc = null;
        }
        try {
            LocalProxy.get().stop();
        } catch (Throwable ignored) {}
    }

    /** 日志尾部若干行，出错时给用户看 */
    String tailLog(int lines) {
        RandomAccessFile f = null;
        try {
            File lf = logFile();
            if (!lf.exists()) return "（暂无日志）";
            long len = lf.length();
            int take = (int) Math.min(len, 16 * 1024);
            f = new RandomAccessFile(lf, "r");
            f.seek(len - take);
            byte[] buf = new byte[take];
            f.readFully(buf);
            String s = new String(buf, "UTF-8");
            String[] all = s.split("\n");
            int from = Math.max(0, all.length - lines);
            StringBuilder sb = new StringBuilder();
            for (int i = from; i < all.length; i++) sb.append(all[i]).append('\n');
            return sb.toString();
        } catch (Throwable t) {
            return "（读取日志失败：" + t + "）";
        } finally {
            if (f != null) try { f.close(); } catch (IOException ignored) {}
        }
    }

    private void pump(final InputStream in) {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                OutputStream out = null;
                try {
                    out = new FileOutputStream(logFile(), true);
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        out.flush();
                        // 同时镜像到 logcat：设备无 root 时，logcat 是唯一
                        // 能读到后端真实报错的通道
                        try {
                            String s = new String(buf, 0, n, "UTF-8");
                            for (String line : s.split("\n")) {
                                if (line.trim().length() > 0) {
                                    android.util.Log.i(TAG, line.length() > 800 ? line.substring(0, 800) : line);
                                }
                            }
                        } catch (Throwable ignored) {}
                    }
                } catch (Throwable ignored) {
                } finally {
                    if (out != null) try { out.close(); } catch (IOException ignored) {}
                    try { in.close(); } catch (IOException ignored) {}
                }
            }
        });
        t.setDaemon(true);
        t.start();
    }

    private void copyAsset(String name, File dst) throws IOException {
        InputStream in = null;
        FileOutputStream out = null;
        try {
            in = app.getAssets().open(name);
            out = new FileOutputStream(dst);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
            if (out != null) try { out.close(); } catch (IOException ignored) {}
        }
    }

    /** 只给调试用：当前进程是否还活着 */
    boolean alive() {
        return proc != null && proc.isAlive();
    }

    /** 扫 /proc，把自己 uid 下残留的 libpansou 进程收掉 */
    private void killStaleBackend() {
        try {
            File[] list = new File("/proc").listFiles();
            if (list == null) return;
            int myUid = android.os.Process.myUid();
            int myPid = android.os.Process.myPid();
            for (File d : list) {
                String name = d.getName();
                if (name.isEmpty() || !Character.isDigit(name.charAt(0))) continue;
                try {
                    int pid = Integer.parseInt(name);
                    if (pid == myPid) continue;
                    String cmd = readSmall(new File(d, "cmdline"));
                    if (cmd == null || !cmd.contains("libpansou")) continue;
                    String status = readSmall(new File(d, "status"));
                    if (status == null) continue;
                    int uid = -1;
                    for (String line : status.split("\n")) {
                        if (line.startsWith("Uid:")) {
                            String[] p = line.trim().split("\\s+");
                            if (p.length > 1) uid = Integer.parseInt(p[1]);
                            break;
                        }
                    }
                    if (uid == myUid) {
                        android.util.Log.i(TAG, "清理残留后端 pid=" + pid);
                        android.os.Process.killProcess(pid);
                    }
                } catch (Throwable ignored) {}
            }
        } catch (Throwable ignored) {}
    }

    private static String readSmall(File f) {
        java.io.FileInputStream in = null;
        try {
            in = new java.io.FileInputStream(f);
            byte[] buf = new byte[4096];
            int n = in.read(buf);
            if (n <= 0) return "";
            return new String(buf, 0, n, "UTF-8").replace('\0', ' ');
        } catch (Throwable t) {
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
        }
    }

    static byte[] drain(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }
}
