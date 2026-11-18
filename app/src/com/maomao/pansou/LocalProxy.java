package com.maomao.pansou;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 本机转发代理。存在的唯一理由：让内置的 Go 后端能解析域名。
 *
 * 背景（实测结论，不是猜测）：
 *   pansou 是 GOOS=linux 静态编译的，God 的 net 包在 Android 上找不到 /etc/resolv.conf，
 *   于是回退到内置默认 DNS 服务器 127.0.0.1:53 / [::1]:53。手机上这两个地址无人应答，
 *   每一次域名解析都以 "connection refused" 失败，所有插件请求根本发不出去。
 *   而 Android 的 ip_unprivileged_port_start=1024，普通 App 绑不了 53，无法在本地补一个 DNS。
 *
 * 解法：App 自己起一个 HTTP 转发代理，把 Go 的 HTTP_PROXY/HTTPS_PROXY 指过来。
 *   Go 只连 127.0.0.1（纯 IP，不需要解析），目标域名的解析交给本类，
 *   走的是 Java 的 InetAddress —— 也就是系统 netd，DNS 完全正常。
 *
 * 支持两种请求：
 *   CONNECT host:port  —— HTTPS 隧道，双向裸转发（插件绝大多数是 https，走这条）
 *   GET http://...     —— 普通 HTTP，改写为 origin-form 后转发
 */
final class LocalProxy {

    private static final String TAG = "PansouProxy";

    private static LocalProxy INSTANCE;

    private ServerSocket ss;
    private volatile boolean running;
    private int port = -1;

    static synchronized LocalProxy get() {
        if (INSTANCE == null) INSTANCE = new LocalProxy();
        return INSTANCE;
    }

    int port() {
        return port;
    }

    boolean isRunning() {
        return running && ss != null && !ss.isClosed();
    }

    /** 启动并返回实际端口；port 被占则顺延尝试 */
    synchronized int start(int preferred) throws IOException {
        if (isRunning()) return port;

        InetAddress loop = InetAddress.getByName("127.0.0.1");
        IOException last = null;
        for (int p = preferred; p < preferred + 12; p++) {
            try {
                ss = new ServerSocket(p, 128, loop);
                port = p;
                last = null;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (ss == null) throw last != null ? last : new IOException("本地转发端口不可用");

        running = true;
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                acceptLoop();
            }
        }, "proxy-accept");
        t.setDaemon(true);
        t.start();
        android.util.Log.i(TAG, "本地转发代理已启动 127.0.0.1:" + port);
        return port;
    }

    synchronized void stop() {
        running = false;
        try {
            if (ss != null) ss.close();
        } catch (IOException ignored) {}
        ss = null;
    }

    private void acceptLoop() {
        while (running) {
            Socket s;
            try {
                s = ss.accept();
            } catch (IOException e) {
                if (running) {
                    try {
                        Thread.sleep(50);
                    } catch (InterruptedException ignored) {}
                    continue;
                }
                return;
            }
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
            }, "proxy-conn");
            t.setDaemon(true);
            t.start();
        }
    }

    private void handle(Socket sock) throws IOException {
        sock.setSoTimeout(60000);
        sock.setTcpNoDelay(true);
        InputStream in = new BufferedInputStream(sock.getInputStream(), 16384);
        OutputStream out = sock.getOutputStream();

        String reqLine = readLine(in);
        if (reqLine == null || reqLine.isEmpty()) return;

        String[] parts = reqLine.split(" ");
        if (parts.length < 2) return;
        String method = parts[0].toUpperCase(Locale.US);
        String target = parts[1];

        // 先收完客户端请求头
        Map<String, String> hdrs = new LinkedHashMap<String, String>();
        String line;
        while ((line = readLine(in)) != null && !line.isEmpty()) {
            int i = line.indexOf(':');
            if (i > 0) {
                hdrs.put(line.substring(0, i).trim().toLowerCase(Locale.US),
                        line.substring(i + 1).trim());
            }
        }

        if ("CONNECT".equals(method)) {
            tunnel(target, in, out);
        } else {
            forwardHttp(method, target, hdrs, in, out);
        }
    }

    // ------------------------------------------------------------ HTTPS 隧道

    private void tunnel(String authority, InputStream cin, OutputStream cout) {
        String host;
        int p = 443;
        if (authority.startsWith("[")) {
            // [::1]:443
            int rb = authority.indexOf(']');
            if (rb > 0) {
                host = authority.substring(1, rb);
                if (rb + 1 < authority.length() && authority.charAt(rb + 1) == ':') {
                    try {
                        p = Integer.parseInt(authority.substring(rb + 2));
                    } catch (NumberFormatException ignored) {}
                }
            } else {
                host = authority.substring(1);
            }
        } else {
            int colon = authority.lastIndexOf(':');
            if (colon > 0) {
                host = authority.substring(0, colon);
                try {
                    p = Integer.parseInt(authority.substring(colon + 1));
                } catch (NumberFormatException ignored) {}
            } else {
                host = authority;
            }
        }

        Socket up = null;
        try {
            up = new Socket();
            // 这里的 InetSocketAddress(String,int) 会走 Java 的解析器 = 系统 netd
            up.connect(new InetSocketAddress(host, p), 12000);
            up.setTcpNoDelay(true);

            cout.write("HTTP/1.1 200 Connection Established\r\n\r\n".getBytes("ISO-8859-1"));
            cout.flush();

            relay(up, cin, cout);
        } catch (Throwable t) {
            try {
                cout.write(("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                        .getBytes("ISO-8859-1"));
                cout.flush();
            } catch (IOException ignored) {}
        } finally {
            if (up != null) try { up.close(); } catch (IOException ignored) {}
        }
    }

    /** 双向裸转发，任一方向结束即收工 */
    private void relay(Socket up, InputStream cin, OutputStream cout) throws IOException {
        final Socket target = up;
        final InputStream uin = new BufferedInputStream(up.getInputStream(), 32768);
        final OutputStream uout = up.getOutputStream();

        Thread up2down = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    byte[] buf = new byte[32768];
                    int n;
                    while ((n = uin.read(buf)) > 0) {
                        cout.write(buf, 0, n);
                        cout.flush();
                    }
                } catch (Throwable ignored) {
                } finally {
                    try { target.close(); } catch (IOException ignored) {}
                }
            }
        }, "proxy-up2down");
        up2down.setDaemon(true);
        up2down.start();

        try {
            byte[] buf = new byte[32768];
            int n;
            while ((n = cin.read(buf)) > 0) {
                uout.write(buf, 0, n);
                uout.flush();
            }
        } catch (Throwable ignored) {
        } finally {
            try { target.close(); } catch (IOException ignored) {}
        }
        try { up2down.join(2000); } catch (InterruptedException ignored) {}
    }

    // ------------------------------------------------------------ 普通 HTTP

    private void forwardHttp(String method, String target, Map<String, String> hdrs,
                             InputStream cin, OutputStream cout) throws IOException {
        // target 形如 http://host[:port]/path
        String rest = target;
        String scheme = "http";
        int s = rest.indexOf("://");
        if (s > 0) {
            scheme = rest.substring(0, s).toLowerCase(Locale.US);
            rest = rest.substring(s + 3);
        }
        int slash = rest.indexOf('/');
        String authority = slash >= 0 ? rest.substring(0, slash) : rest;
        String path = slash >= 0 ? rest.substring(slash) : "/";
        if (path.isEmpty()) path = "/";

        String host = authority;
        int p = "https".equals(scheme) ? 443 : 80;
        int colon = authority.lastIndexOf(':');
        if (colon > 0 && colon > authority.lastIndexOf(']')) {
            host = authority.substring(0, colon);
            try {
                p = Integer.parseInt(authority.substring(colon + 1));
            } catch (NumberFormatException ignored) {}
        }

        Socket up = null;
        try {
            up = new Socket();
            up.connect(new InetSocketAddress(host, p), 12000);
            up.setSoTimeout(60000);
            InputStream uin = new BufferedInputStream(up.getInputStream(), 16384);
            OutputStream uout = up.getOutputStream();

            StringBuilder sb = new StringBuilder();
            sb.append(method).append(' ').append(path).append(" HTTP/1.1\r\n");
            for (Map.Entry<String, String> e : hdrs.entrySet()) {
                String k = e.getKey();
                if ("proxy-connection".equals(k) || "connection".equals(k)) continue;
                sb.append(k).append(": ").append(e.getValue()).append("\r\n");
            }
            if (!hdrs.containsKey("host")) sb.append("Host: ").append(authority).append("\r\n");
            sb.append("Connection: close\r\n\r\n");
            uout.write(sb.toString().getBytes("ISO-8859-1"));
            uout.flush();

            // 有 body 就转发（Content-Length 或 chunked）
            String cl = hdrs.get("content-length");
            if (cl != null) {
                int len;
                try {
                    len = Integer.parseInt(cl);
                } catch (NumberFormatException e) {
                    len = 0;
                }
                byte[] buf = new byte[8192];
                int left = len;
                while (left > 0) {
                    int n = cin.read(buf, 0, Math.min(buf.length, left));
                    if (n <= 0) break;
                    uout.write(buf, 0, n);
                    left -= n;
                }
                uout.flush();
            }

            byte[] buf = new byte[16384];
            int n;
            while ((n = uin.read(buf)) > 0) cout.write(buf, 0, n);
            cout.flush();
        } catch (Throwable t) {
            try {
                cout.write(("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                        .getBytes("ISO-8859-1"));
                cout.flush();
            } catch (IOException ignored) {}
        } finally {
            if (up != null) try { up.close(); } catch (IOException ignored) {}
        }
    }

    // ------------------------------------------------------------ 工具

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
}
