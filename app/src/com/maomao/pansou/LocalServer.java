package com.maomao.pansou;

import android.content.res.AssetManager;

import java.io.BufferedInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 本机小服务：把 APK 里的前端（assets/www）当静态站点发出去，并把 /api 一类的请求
 * 反代到 127.0.0.1:18888 的 pansou。
 *
 * 为什么要这一层：前端是用相对路径 /api 调后端的（原本靠 Caddy 同域反代）。
 * 如果直接 file:// 加载 assets，相对路径会变成 file:///api 直接失败。
 * 起一个 127.0.0.1 的 HTTP 服务，前端逻辑一行都不用改。
 */
final class LocalServer {

    /** 与盒子上 Caddyfile 的 @api 完全一致 */
    private static final String[] PROXY_PREFIX = {
            "/api/", "/qqpd/", "/gying/", "/panlian/", "/weibo/", "/woniu/"
    };

    /**
     * 前端站点的固定端口。必须是固定值：WebView 的 localStorage 按
     * 「协议 + 域名 + 端口」分区，端口一变就是另一个站点，用户保存的
     * 网盘配置（pansou_disk_types / pansou_plugins）立刻读不到，
     * 页面会退回默认的全选状态——这就是「保存后重启又变回去」的原因。
     */
    static final int PREFERRED_PORT = 18887;

    private final AssetManager am;
    private final int upstreamPort;

    private ServerSocket ss;
    private volatile boolean running;
    private int port = -1;

    /** 配置快照的来源。每次发首页都现取，保证拿到的不是旧值 */
    interface CfgSource {
        String snapshot();
    }

    private volatile CfgSource cfgSource;

    void setCfgSource(CfgSource s) {
        cfgSource = s;
    }

    /** 进程内单例：界面重建时复用同一个 socket，避免抢不到固定端口而退回随机端口 */
    private static LocalServer instance;

    static synchronized LocalServer obtain(AssetManager am, int upstreamPort) {
        if (instance == null || !instance.running) {
            instance = new LocalServer(am, upstreamPort);
        }
        return instance;
    }

    LocalServer(AssetManager am, int upstreamPort) {
        this.am = am;
        this.upstreamPort = upstreamPort;
    }

    int start() throws IOException {
        if (running && ss != null && !ss.isClosed()) return port;
        IOException last = null;
        for (int i = 0; i < 8; i++) {
            try {
                ss = new ServerSocket(PREFERRED_PORT, 50, InetAddress.getByName("127.0.0.1"));
                break;
            } catch (IOException e) {
                last = e;
                try {
                    Thread.sleep(200);
                } catch (InterruptedException ignored) {}
            }
        }
        if (ss == null) {
            // 固定端口实在抢不到（极少见）。宁可起来也不能白屏，但换端口意味着
            // 用户配置读不到，所以留一条显眼的日志。
            android.util.Log.w("PansouWeb", "固定端口 " + PREFERRED_PORT + " 不可用，改用临时端口", last);
            ss = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        }
        port = ss.getLocalPort();
        android.util.Log.i("PansouWeb", "前端站点: http://127.0.0.1:" + port);
        running = true;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "local-http");
        t.setDaemon(true);
        t.start();
        return port;
    }

    int port() {
        return port;
    }

    private String currentSnapshot() {
        try {
            CfgSource s = cfgSource;
            return s == null ? "{}" : s.snapshot();
        } catch (Throwable t) {
            return "{}";
        }
    }

    void stop() {
        running = false;
        try {
            if (ss != null) ss.close();
        } catch (IOException ignored) {}
    }

    private void acceptLoop() {
        while (running) {
            Socket s = null;
            try {
                s = ss.accept();
                final Socket sock = s;
                Thread t = new Thread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            handle(sock);
                        } catch (Throwable ignored) {
                        } finally {
                            try {
                                sock.close();
                            } catch (IOException ignored) {}
                        }
                    }
                }, "local-conn");
                t.setDaemon(true);
                t.start();
            } catch (IOException e) {
                if (running) {
                    try {
                        Thread.sleep(50);
                    } catch (InterruptedException ignored) {}
                }
            }
        }
    }

    private void handle(Socket sock) throws IOException {
        sock.setSoTimeout(60000);
        InputStream in = new BufferedInputStream(sock.getInputStream(), 8192);
        OutputStream out = sock.getOutputStream();

        String reqLine = readLine(in);
        if (reqLine == null || reqLine.length() == 0) return;

        String[] parts = reqLine.split(" ");
        if (parts.length < 2) return;
        String method = parts[0].toUpperCase(Locale.US);
        String target = parts[1];

        Map<String, String> hdrs = new LinkedHashMap<String, String>();
        int contentLength = 0;
        String line;
        while ((line = readLine(in)) != null && line.length() > 0) {
            int i = line.indexOf(':');
            if (i > 0) {
                String k = line.substring(0, i).trim().toLowerCase(Locale.US);
                String v = line.substring(i + 1).trim();
                hdrs.put(k, v);
                if (k.equals("content-length")) {
                    try {
                        contentLength = Integer.parseInt(v);
                    } catch (NumberFormatException ignored) {}
                }
            }
        }

        byte[] body = null;
        if (contentLength > 0 && contentLength < 8 * 1024 * 1024) {
            body = readExact(in, contentLength);
        }

        if ("OPTIONS".equals(method)) {
            writeSimple(out, 204, null, new byte[0], false, false);
            return;
        }

        if (isProxyPath(target)) {
            proxy(method, target, hdrs, body, out);
        } else {
            serveStatic(method, target, out);
        }
    }

    private boolean isProxyPath(String target) {
        String path = target;
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        if ("/api".equals(path)) return true;
        for (String p : PROXY_PREFIX) {
            if (path.startsWith(p)) return true;
        }
        return false;
    }

    // ---------------------------------------------------------------- 反代

    private void proxy(String method, String target, Map<String, String> hdrs,
                       byte[] body, OutputStream out) throws IOException {
        Socket up = new Socket();
        InputStream ui = null;
        try {
            up.connect(new InetSocketAddress("127.0.0.1", upstreamPort), 3000);
            up.setSoTimeout(90000);
            OutputStream uo = up.getOutputStream();

            StringBuilder sb = new StringBuilder();
            sb.append(method).append(' ').append(target).append(" HTTP/1.1\r\n");
            sb.append("Host: 127.0.0.1:").append(upstreamPort).append("\r\n");
            sb.append("Connection: close\r\n");
            // 不带 Accept-Encoding：拿未压缩的响应直接透传，省掉解压/重压缩
            copy(hdrs, sb, "content-type");
            copy(hdrs, sb, "accept");
            copy(hdrs, sb, "accept-language");
            copy(hdrs, sb, "authorization");
            copy(hdrs, sb, "cookie");
            copy(hdrs, sb, "user-agent");
            copy(hdrs, sb, "x-requested-with");
            if (body != null) sb.append("Content-Length: ").append(body.length).append("\r\n");
            else if ("POST".equals(method) || "PUT".equals(method)) sb.append("Content-Length: 0\r\n");
            sb.append("\r\n");

            uo.write(sb.toString().getBytes("ISO-8859-1"));
            if (body != null) uo.write(body);
            uo.flush();

            // 原样透传响应头+响应体，靠上游 Connection: close 收尾
            ui = new BufferedInputStream(up.getInputStream(), 16384);
            byte[] buf = new byte[16384];
            int n;
            while ((n = ui.read(buf)) > 0) out.write(buf, 0, n);
            out.flush();
        } catch (IOException e) {
            try {
                writeSimple(out, 502, "text/plain; charset=utf-8",
                        ("后端请求失败：" + e.getMessage()).getBytes("UTF-8"), false, false);
            } catch (IOException ignored) {}
        } finally {
            if (ui != null) try { ui.close(); } catch (IOException ignored) {}
            try { up.close(); } catch (IOException ignored) {}
        }
    }

    private static void copy(Map<String, String> hdrs, StringBuilder sb, String name) {
        String v = hdrs.get(name);
        if (v != null && v.length() > 0) sb.append(name).append(": ").append(v).append("\r\n");
    }

    // ---------------------------------------------------------------- 静态

    private void serveStatic(String method, String target, OutputStream out) throws IOException {
        String path = target;
        int q = path.indexOf('?');
        if (q >= 0) path = path.substring(0, q);
        try {
            path = URLDecoder.decode(path, "UTF-8");
        } catch (Throwable ignored) {}
        if (path.contains("..")) path = "/";
        if (path.equals("/") || path.length() == 0) path = "/index.html";

        byte[] data = readAsset("www" + path);
        String ctype = data != null ? mimeOf(path) : null;

        if (data == null) {
            // SPA 回退：没有扩展名的路径交还给 index.html；带扩展名的老实 404
            int dot = path.lastIndexOf('.');
            int slash = path.lastIndexOf('/');
            if (dot <= slash) {
                data = readAsset("www/index.html");
                ctype = "text/html; charset=utf-8";
                path = "/index.html";
            }
        }
        if (data == null) {
            writeSimple(out, 404, "text/plain; charset=utf-8", "404 Not Found".getBytes("UTF-8"), false, method.equals("HEAD"));
            return;
        }

        boolean noStore = path.equals("/index.html");
        if (noStore && data != null) {
            data = injectCfg(data);
            ctype = "text/html; charset=utf-8";
        }
        writeSimple(out, 200, ctype, data, noStore, method.equals("HEAD"));
    }

    /**
     * 在首页 <head> 最前面插一段同步脚本：把原生备份的配置回填进 localStorage，
     * 并接管 setItem，让前端一保存就同步回原生。
     *
     * 必须在 Vue 启动之前跑完，所以插在第一个 <script type="module"> 之前——
     * 那段脚本是 defer 语义，此处先执行，页面挂载时读到的就已经是回填后的值。
     */
    private byte[] injectCfg(byte[] html) {
        String s;
        try {
            s = new String(html, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return html;
        }
        if (s.contains("pansou-native-cfg")) return html;

        int at = s.indexOf("<script type=\"module\"");
        if (at < 0) at = s.indexOf("<script");
        if (at < 0) at = s.indexOf("</head>");
        if (at < 0) return html;

        String inject = buildInjectScript();
        try {
            return (s.substring(0, at) + inject + s.substring(at)).getBytes("UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return html;
        }
    }

    /**
     * 组装注入脚本。脚本体放在 assets/www/pansou-native.js，这里只做占位符替换，
     * 逻辑改动不用碰 Java。
     */
    private String buildInjectScript() {
        byte[] js = readAsset("www/pansou-native.js");
        if (js == null) return "";
        String body;
        try {
            body = new String(js, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            return "";
        }

        // 配置值理论上不含 </script>，防一手，免得提前闭合标签
        String json = currentSnapshot().replace("</", "<\\/");

        StringBuilder keys = new StringBuilder("[");
        for (int i = 0; i < Prefs.CFG_KEYS.length; i++) {
            if (i > 0) keys.append(',');
            keys.append('"').append(Prefs.CFG_KEYS[i]).append('"');
        }
        keys.append(']');

        body = body.replace("__PANSOU_NATIVE_CFG__", json)
                   .replace("__PANSOU_CFG_KEYS__", keys.toString());

        return "<script id=\"pansou-native-cfg\">\n" + body + "\n</script>\n";
    }

    private void writeSimple(OutputStream out, int code, String ctype, byte[] body,
                             boolean noStore, boolean headOnly) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(code).append(' ').append(reason(code)).append("\r\n");
        if (ctype != null) h.append("Content-Type: ").append(ctype).append("\r\n");
        h.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n");
        h.append("Cache-Control: ").append(noStore ? "no-store" : "public, max-age=86400").append("\r\n");
        h.append("Access-Control-Allow-Origin: *\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes("ISO-8859-1"));
        if (!headOnly && body != null && body.length > 0) out.write(body);
        out.flush();
    }

    private static String reason(int code) {
        switch (code) {
            case 200: return "OK";
            case 204: return "No Content";
            case 404: return "Not Found";
            case 502: return "Bad Gateway";
            default: return "OK";
        }
    }

    private byte[] readAsset(String name) {
        InputStream in = null;
        try {
            in = am.open(name);
            return Backend.drain(in);
        } catch (FileNotFoundException e) {
            return null;
        } catch (IOException e) {
            return null;
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) {}
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".webp")) return "image/webp";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        if (p.endsWith(".ttf")) return "font/ttf";
        if (p.endsWith(".txt") || p.endsWith(".map")) return "text/plain; charset=utf-8";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- 工具

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder(128);
        int b;
        boolean any = false;
        while ((b = in.read()) != -1) {
            any = true;
            if (b == '\n') break;
            if (b != '\r') sb.append((char) (b & 0xFF));
        }
        if (!any && sb.length() == 0) return null;
        return sb.toString();
    }

    private static byte[] readExact(InputStream in, int len) throws IOException {
        byte[] buf = new byte[len];
        int off = 0;
        while (off < len) {
            int n = in.read(buf, off, len - off);
            if (n <= 0) break;
            off += n;
        }
        if (off == len) return buf;
        byte[] cut = new byte[off];
        System.arraycopy(buf, 0, cut, 0, off);
        return cut;
    }
}
