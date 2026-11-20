/*
 * 原生配置兜底。由 App 在发首页时内联进 <script>，在 Vue 启动之前执行。
 *
 * 为什么需要它：WebView 的 localStorage 按「协议+域名+端口」分区。端口一变、
 * 缓存被清、或者进程被杀时写入没落盘，前端保存的设置就读不到了，页面退回默认值
 * （检测开关默认关闭、网盘类型默认全选）——这就是「保存后重启又变回去」。
 *
 * 规则：只做单向补齐，绝不用旧值盖掉新值。
 *   - 本地有值        → 保持，并回写原生（本地永远是最新的）
 *   - 本地没有        → 用原生备份补上
 */
(function () {
  var NATIVE = __PANSOU_NATIVE_CFG__;
  var KEYS = __PANSOU_CFG_KEYS__;
  var LS = window.localStorage;

  function log(m) {
    try {
      console.log('[PansouNative] ' + m);
    } catch (e) {}
  }

  function nativePut(k, v) {
    try {
      if (window.PansouNative) window.PansouNative.put(k, v);
    } catch (e) {}
  }

  /*
   * 空配置自愈。
   * 配置页的「取消全选」或连点会把 pansou_channels / pansou_plugins 写成 "[]"；
   * 前端只要看到这个键「存在」，就当成用户主动全不选，于是频道、插件列表全是
   * 空的、统计变 0——用户看到的就是「TG 频道和搜索插件都没了」。
   * 这里把空数组的键清掉（含原生备份），让前端回落到后端默认列表。
   */
  (function healEmpty() {
    var WATCH = ['pansou_channels', 'pansou_plugins'];
    function isEmptyArray(raw) {
      if (!raw) return false;
      try {
        var a = JSON.parse(raw);
        return Object.prototype.toString.call(a) === '[object Array]' && a.length === 0;
      } catch (e) {
        return false;
      }
    }
    for (var i = 0; i < WATCH.length; i++) {
      var k = WATCH[i];
      var raw = null;
      try { raw = LS.getItem(k); } catch (e) {}
      if (isEmptyArray(raw)) {
        try { LS.removeItem(k); } catch (e) {}
        nativePut(k, null);
        log('空配置自愈 ' + k + ' 原值 [] 已清除，回落后端默认');
      }
      if (Object.prototype.hasOwnProperty.call(NATIVE, k) && isEmptyArray(NATIVE[k])) {
        delete NATIVE[k];
        nativePut(k, null);
        log('空配置自愈 原生快照 ' + k + ' 已清除');
      }
    }
  })();

  var restored = [];
  var saved = [];

  try {
    for (var k in NATIVE) {
      if (!Object.prototype.hasOwnProperty.call(NATIVE, k)) continue;
      var cur = null;
      try {
        cur = LS.getItem(k);
      } catch (e) {}
      if (cur === null) {
        LS.setItem(k, NATIVE[k]);
        restored.push(k);
      } else if (cur !== NATIVE[k]) {
        nativePut(k, cur);
        saved.push(k);
      }
    }
    // 全新安装：检测默认开启。本机有值（用户自己改过）或原生有备份（老用户）时
    // 一律不动——不能把人家手动关掉的设置又打开，那比默认关闭更烦人。
    var DK = 'pansou_detection_settings';
    var dcur = null;
    try { dcur = LS.getItem(DK); } catch (e) {}
    if (dcur === null && !Object.prototype.hasOwnProperty.call(NATIVE, DK)) {
      LS.setItem(DK, '{"enabled":true}');
      restored.push('detection(default-on)');
    }

    for (var i = 0; i < KEYS.length; i++) {
      var k2 = KEYS[i];
      var v2 = null;
      try {
        v2 = LS.getItem(k2);
      } catch (e) {}
      if (v2 !== null && !(k2 in NATIVE)) {
        nativePut(k2, v2);
        saved.push(k2);
      }
    }
    log('origin=' + location.origin + ' 回填[' + restored.join(',') + '] 回写[' + saved.join(',') + ']');
  } catch (e) {
    log('回填失败: ' + e);
  }

  /* 前端一点「保存配置」就同步回原生，不必等下一次启动 */
  try {
    var _set = LS.setItem.bind(LS);
    LS.setItem = function (k, v) {
      _set(k, v);
      try {
        if (k && KEYS.indexOf(k) >= 0) nativePut(k, String(v));
      } catch (e) {}
    };
  } catch (e) {
    log('接管 setItem 失败: ' + e);
  }

  window.addEventListener('config:saved', function () {
    var o = {};
    for (var i = 0; i < KEYS.length; i++) {
      try {
        o[KEYS[i]] = LS.getItem(KEYS[i]);
      } catch (e) {}
    }
    log('config:saved ' + JSON.stringify(o));
  });

  /*
   * 配置页的「保存配置」按钮在面板最底下，中间一大片空白，不滚到底根本看不见，
   * 用户改完选项以为已经生效，实际什么都没存——重启自然打回原状。
   * 检测开关只有开/关两种状态，没有中间态要暂存，所以点一下就存，符合直觉。
   */
  document.addEventListener(
    'change',
    function (e) {
      var t = e.target;
      if (!t || t.id !== 'detection-toggle') return;
      try {
        var cur = {};
        var raw = LS.getItem('pansou_detection_settings');
        if (raw) cur = JSON.parse(raw) || {};
        cur.enabled = !!t.checked;
        // 走被接管的 setItem，顺手同步回原生
        LS.setItem('pansou_detection_settings', JSON.stringify(cur));
        log('检测开关即时落盘 enabled=' + cur.enabled);
      } catch (err) {
        log('检测开关落盘失败: ' + err);
      }
    },
    true
  );

  /*
   * TG频道 / 搜索插件 / 网盘类型：选择即保存。
   *
   * 这里不自己拼配置值——网盘卡片显示的是「百度」「夸克」这类中文，存进
   * localStorage 的却是 baidu/quark 这种 key，硬编码映射必然出错。做法是
   * 在选项点击后由脚本代点一次「保存配置」，让前端自己算值、自己写；
   * 落盘经过上面被接管的 setItem，顺带同步回原生。
   *
   * 事件委托挂在 document 上：Vue 会反复重建 DOM，直接绑元素会失效。
   * 用冒泡阶段，等 Vue 自己的 click 处理器更新完状态再动手。
   */
  var autoSaveTimer = null;
  function autoSaveLater(what) {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    // 连点多个选项时合并成一次保存，避免反复写盘
    autoSaveTimer = setTimeout(function () {
      autoSaveTimer = null;
      try {
        var btn = null;
        var all = document.querySelectorAll('button');
        for (var i = 0; i < all.length; i++) {
          if (all[i].className && String(all[i].className).indexOf('save-btn') >= 0) {
            btn = all[i];
            break;
          }
        }
        if (!btn) return; // 不在配置页
        btn.click();
        log('选择即保存 ' + what);
      } catch (e) {
        log('选择即保存失败: ' + e);
      }
    }, 120);
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t) return;
    // 向上找命中的选项卡片或操作按钮（兼容老 WebView 没有 closest 的情况）
    var el = t;
    var hit = '';
    while (el && el !== document) {
      var cn = (el.className && el.className.baseVal !== undefined) ? el.className.baseVal : el.className;
      cn = String(cn || '');
      if (cn.indexOf('item-card') >= 0) { hit = 'item-card'; break; }
      if (cn.indexOf('action-btn') >= 0) { hit = 'action-btn'; break; }
      el = el.parentNode;
    }
    if (hit) autoSaveLater(hit);
  }, false);

  /* ------------------------------------------------------------------
   * 更新提示：Java 侧查到新版本后调 PansouUpdate.show(tag, url)。
   * 只在搜索主页面（.search-page 存在时）底部画一行红色小字，点击跳 releases。
   *
   * 前端是 Vue SPA，DOM 会被反复重建（切 tab、重渲染）。所以这里不是插一次
   * 就完事，而是用 MutationObserver 盯着，保证红字跟着搜索页走：
   *   进搜索页 → 插入；离开 → 移除；切回来 → 再插入。
   */
  var updateInfo = null;
  var syncing = false;
  var TIP_ID = 'pansou-update-tip';
  // 用户一旦发起搜索就把红字撤掉，且不再出现——搜索结果页要清爽，
  // 不能被「有更新」占着顶部。这是个单向开关，本会话内不恢复。
  var updateDismissed = false;

  function makeTip() {
    var a = document.createElement('a');
    a.id = TIP_ID;
    a.textContent = '有更新：' + (updateInfo ? updateInfo.tag : '新版本') + '，点击下载';
    a.href = (updateInfo && updateInfo.url) || 'https://github.com/lizy2020/PanSou-Android-Network-Disk-Search/releases';
    // 红色小字，居中，跟在搜索内容块后面；点击交给 WebView 转系统浏览器。
    // 不贴页面最底——那里和 footer 挤在一起，红字会被压得看不清。
    a.style.cssText = 'display:block;text-align:center;color:#ef4444;font-size:12px;' +
      'line-height:1.6;margin:8px 0 4px;padding:6px 12px;text-decoration:underline;' +
      'cursor:pointer;-webkit-tap-highlight-color:transparent;';
    return a;
  }

  function removeTip() {
    try {
      var tip = document.getElementById(TIP_ID);
      if (tip && tip.parentNode) {
        tip.parentNode.removeChild(tip);
        log('更新提示已移除（开始搜索）');
      }
    } catch (e) {}
  }

  /** 用户点了搜索按钮或在输入框回车——撤掉红字，本会话不再显示 */
  function dismissUpdateOnSearch(trigger) {
    if (updateDismissed) return;
    updateDismissed = true;
    removeTip();
    log('更新提示已关闭（' + trigger + '）');
  }

  // 事件委托挂 document：Vue 反复重建 DOM，直接绑元素会失效。
  // 主搜索页的搜索触发有两个入口：输入框回车、输入框右侧的纸飞机按钮。
  // 纸飞机按钮没有语义 class，但它是搜索 input 的紧邻兄弟（button），
  // 所以用「点到的 button 的前一个兄弟是搜索框」来识别，比猜 class 稳。
  function isSearchInput(el) {
    if (!el || String(el.tagName || '').toUpperCase() !== 'INPUT') return false;
    var ph = String(el.getAttribute('placeholder') || '');
    return ph.indexOf('搜索资源') >= 0 || ph.indexOf('关键词') >= 0;
  }

  document.addEventListener('click', function (e) {
    if (updateDismissed || !e.target) return;
    var el = e.target;
    // 沿 DOM 向上找，命中 button 时看它是不是搜索框的兄弟（纸飞机）
    while (el && el !== document) {
      if (String(el.tagName || '').toUpperCase() === 'BUTTON') {
        var prev = el.previousElementSibling;
        if (isSearchInput(prev) || isSearchInput(el.nextElementSibling)) {
          dismissUpdateOnSearch('点击搜索');
          return;
        }
      }
      el = el.parentNode;
    }
  }, true);

  document.addEventListener('keydown', function (e) {
    if (updateDismissed || !e.target) return;
    if (e.key !== 'Enter' && e.keyCode !== 13) return;
    var t = e.target;
    var tag = String(t.tagName || '').toUpperCase();
    var editable = tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable;
    if (editable) dismissUpdateOnSearch('回车搜索');
  }, true);

  function syncUpdate() {
    if (!updateInfo || syncing || updateDismissed) return;
    syncing = true;
    try {
      var page = document.querySelector('.search-page');
      var tip = document.getElementById(TIP_ID);
      if (page) {
        if (!tip) {
          // 插在搜索表单块之后、结果块之前：一眼可见，又不会被页脚挤掉
          var form = page.querySelector('.search-form-block');
          var anchor = form && form.nextElementSibling;
          if (anchor && anchor.parentNode === page) {
            page.insertBefore(makeTip(), anchor);
          } else {
            page.appendChild(makeTip());
          }
          log('更新提示已显示 ' + updateInfo.tag);
        }
      } else if (tip && tip.parentNode) {
        tip.parentNode.removeChild(tip);
        log('更新提示已移除（离开搜索页）');
      }
    } catch (e) {
      log('更新提示同步失败: ' + e);
    } finally {
      syncing = false;
    }
  }

  window.PansouUpdate = {
    show: function (tag, url) {
      updateInfo = { tag: tag, url: url };
      log('PansouUpdate.show ' + tag);
      // 用户可能在我们查完版本之前就已经搜起来了——这时别再打扰他
      if (updateDismissed) { log('已开始搜索，跳过更新提示'); return; }
      syncUpdate();
    }
  };

  try {
    var mo = new MutationObserver(function () { syncUpdate(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {
    // 极老的 WebView 没有 MutationObserver，退化为定时轮询
    setInterval(syncUpdate, 2000);
  }
})();

/* ==================================================================
 * 界面壁纸
 *   内置渐变 + 相册自定义图。配置存原生 SharedPreferences（走 PansouWallpaperNative
 *   Bridge），不走 localStorage——图片 dataURL 很大，内联进 HTML 会撑爆页面，
 *   且原生存储不受 WebView 按端口分区 / 清缓存影响。
 *   背景样式插在 <head>，class 挂在 <html> 上，因为本脚本在 <body> 解析前就执行。
 *   DOM 用 MutationObserver 兜 Vue 反复重建。
 * ================================================================== */
(function () {
  var NATIVE = window.PansouWallpaperNative;
  if (!NATIVE) return;

  var ROOT = document.documentElement;
  var STYLE_ID = 'pansou-wp-style';
  var PANEL_ID = 'pansou-wp-panel';

  // 内置渐变壁纸。none = 关闭壁纸（回到原纯色主题）
  // lum = 该渐变的大致平均亮度（0~1），用来决定标题文字该用白字还是深字
  var GRADS = [
    { id: 'none',      name: '关闭',   lum: 1,    css: '' },
    { id: 'aurora',    name: '薄荷',   lum: 0.87, css: 'linear-gradient(135deg,#a8edea 0%,#fed6e3 100%)' },
    { id: 'ocean',     name: '海洋',   lum: 0.70, css: 'linear-gradient(135deg,#4facfe 0%,#00f2fe 100%)' },
    { id: 'sunset',    name: '日落',   lum: 0.72, css: 'linear-gradient(135deg,#fa709a 0%,#fee140 100%)' },
    { id: 'lavender',  name: '薰衣草', lum: 0.78, css: 'linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)' },
    { id: 'mint',      name: '青草',   lum: 0.85, css: 'linear-gradient(135deg,#d4fc79 0%,#96e6a1 100%)' },
    { id: 'peach',     name: '蜜桃',   lum: 0.90, css: 'linear-gradient(135deg,#ffecd2 0%,#fcb69f 100%)' },
    { id: 'midnight',  name: '午夜',   lum: 0.14, css: 'linear-gradient(135deg,#0f2027 0%,#203a43 50%,#2c5364 100%)' }
  ];
  var DEFAULT = { type: 'builtin', value: 'aurora', alpha: 0.5 };
  var cfg = { type: DEFAULT.type, value: DEFAULT.value, alpha: DEFAULT.alpha, custom: '' };

  // 当前壁纸的平均亮度：决定文字墨色（深壁纸白字 / 浅壁纸深字）
  var lastLum = 0.85;
  // 已采样过亮度的自定义图 URL，避免 applyBg → inkFromImage → applyBg 无限递归
  var inkUrl = '';
  // 上一次做过墨色重扫的壁纸标识，滑块调透明度时不重复全量扫描
  var lastInkKey = '';

  /* ---- 壁纸层 ------------------------------------------------------
   * 以前壁纸是直接盖在 body 上的（background-attachment:fixed + cover）。
   * 点输入框弹键盘时 WebView 走 adjustResize，把「视口高度」压小，
   * cover 就会按新比例重新裁切 —— 用户看到的就是壁纸突然放大 / 上下窜。
   * 现在改成独立的一层 fixed 元素，尺寸在首次套用时按当时视口写成像素；
   * 只有宽度变化（转屏）才重算，键盘引起的高度变化一律忽略。
   */
  var layerEl = null;
  var baseW = 0, baseH = 0;

  function ensureLayer() {
    if (layerEl && layerEl.parentNode) return layerEl;
    if (!document.body) {
      // 本脚本在 <head> 里就跑了一次 applyBg，那时还没有 body。
      // 等 body 解析出来再补一次，否则壁纸层永远建不出来（会退回「没有壁纸」的纯色）。
      if (!ensureLayer.pending) {
        ensureLayer.pending = 1;
        document.addEventListener('DOMContentLoaded', function () {
          ensureLayer.pending = 0;
          applyBg();
        });
      }
      return null;
    }
    var el = document.getElementById('pansou-wp-layer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pansou-wp-layer';
      document.body.insertBefore(el, document.body.firstChild);
    }
    layerEl = el;
    if (!el.__psVv) {
      el.__psVv = 1;
      // 个别 ROM 弹键盘是「把页面顶上去」而不是缩视口：跟着视觉视口平移，
      // 让壁纸钉在屏幕上，不跟着内容走。
      var vv = window.visualViewport;
      if (vv) {
        var sync = function () {
          if (!layerEl) return;
          var dx = Math.round(vv.offsetLeft || 0);
          var dy = Math.round(vv.offsetTop || 0);
          layerEl.style.transform = (dx || dy) ? 'translate(' + dx + 'px,' + dy + 'px)' : '';
        };
        try {
          vv.addEventListener('scroll', sync);
          vv.addEventListener('resize', sync);
        } catch (e) {}
      }
    }
    return el;
  }

  function sizeLayer() {
    var el = layerEl;
    if (!el) return;
    var w = window.innerWidth || ROOT.clientWidth || 0;
    var h = window.innerHeight || ROOT.clientHeight || 0;
    if (!w || !h) return;
    // 宽度没变 = 只是键盘把高度压小了，保持原尺寸（不缩放、不重新裁切）
    if (baseW && w === baseW) return;
    baseW = w;
    baseH = h;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
  }

  // 转屏才需要重算尺寸（sizeLayer 内部按宽度判断，弹键盘的 resize 会被忽略）
  try {
    window.addEventListener('resize', function () { sizeLayer(); });
    window.addEventListener('orientationchange', function () { setTimeout(sizeLayer, 300); });
  } catch (e) {}

  function wlog(m) {
    try { console.log('[PansouWallpaper] ' + m); } catch (e) {}
  }

  function gradCss(id) {
    for (var i = 0; i < GRADS.length; i++) {
      if (GRADS[i].id === id) return GRADS[i].css;
    }
    return '';
  }

  function gradLum(id) {
    for (var i = 0; i < GRADS.length; i++) {
      if (GRADS[i].id === id) return GRADS[i].lum;
    }
    return 0.85;
  }

  /**
   * 壁纸下的文字墨色。深色壁纸用白字，浅色壁纸用深字——
   * 这样无论用户挑了什么壁纸，直接压在壁纸上的文字都能读清。
   * 阴影做双层：一层贴边压暗/提亮保证边缘，一层扩散托底，
   * 中等亮度（既不够黑也不够白）的壁纸也不会糊成一团。
   */
  function inkFor(lum) {
    lastLum = lum;
    var onDark = lum < 0.52;
    ROOT.style.setProperty('--wp-ink', onDark ? '#ffffff' : '#0b1220');
    ROOT.style.setProperty('--wp-ink-dim',
      onDark ? 'rgba(255,255,255,.86)' : 'rgba(11,18,32,.8)');
    ROOT.style.setProperty('--wp-ink-shadow', onDark
      ? '0 1px 2px rgba(0,0,0,.62),0 0 5px rgba(0,0,0,.45)'
      : '0 1px 2px rgba(255,255,255,.95),0 0 5px rgba(255,255,255,.7)');
    // 顶栏图标按钮的描边：--border 是固定的浅灰（220 13% 91%），
    // 压在浅色壁纸上等于没有框，得按壁纸明暗另给一条线
    ROOT.style.setProperty('--wp-line',
      onDark ? 'rgba(255,255,255,.46)' : 'rgba(15,23,42,.26)');
  }

  /** 自定义图片没有预设亮度：缩到 8x8 采样算平均亮度（不读整图，省内存） */
  function inkFromImage(url) {
    try {
      var img = new Image();
      img.onload = function () {
        var lum = 0.5;
        try {
          var c = document.createElement('canvas');
          c.width = 8;
          c.height = 8;
          var g = c.getContext('2d');
          g.drawImage(img, 0, 0, 8, 8);
          var d = g.getImageData(0, 0, 8, 8).data;
          var sum = 0;
          for (var i = 0; i < d.length; i += 4) {
            sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          }
          lum = sum / (d.length / 4) / 255;
        } catch (e) {}
        inkUrl = url;
        inkFor(lum);
        // 亮度到手后重跑一次：让依赖明暗的底衬/描边跟着改口径
        applyBg();
        repaintInk();
      };
      img.onerror = function () { inkFor(0.5); repaintInk(); };
      img.src = url;
    } catch (e) {}
  }

  /* ==================================================================
   * 文字墨色：找出「直接压在壁纸上」的文字，跟着壁纸明暗换黑白。
   *
   * 判断依据不是猜，而是一次自上而下的遍历里记着「祖先有没有不透明底色」：
   * 只要从元素到 body 之间没有任何背景（色块/背景图），它的字就是直接坐在
   * 壁纸上的，必须跟着壁纸明暗换色；卡片里、按钮上的字有底衬，保持原样。
   * 品牌色（蓝/红/绿）不动，只把黑灰两档换成白/浅白，避免把按钮弄花。
   * ================================================================== */
  var inkSeen = null;   // 本轮已判定过的元素
  var inkQueue = [];
  var inkTimer = 0;

  function hasFill(cs) {
    if (!cs) return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    var bg = cs.backgroundColor;
    return !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
  }

  /** 颜色是否灰阶（品牌色保留，只换黑/灰两档） */
  function isGray(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return true;
    var p = m[1].split(',');
    if (p.length > 3 && +p[3] < 0.15) return false;
    var r = +p[0], g = +p[1], b = +p[2];
    return Math.max(r, g, b) - Math.min(r, g, b) < 32;
  }

  function colorLum(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return 0;
    var p = m[1].split(',');
    return (0.2126 * +p[0] + 0.7152 * +p[1] + 0.0722 * +p[2]) / 255;
  }

  function paintText(el, covered, cs) {
    if (el.classList
        && (el.classList.contains('pansou-ink-x') || el.classList.contains('pansou-ink-dim'))) return;
    if (el.classList && el.classList.contains('pansou-ink')) return;
    if (el.closest && (el.closest('.pansou-wp-panel') || el.closest('.pansou-wp-mask')
        || el.closest('.pansou-wp-launcher'))) return;

    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var nd = el.childNodes[i];
      if (nd.nodeType === 3 && /\S/.test(nd.textContent)) { hasText = true; break; }
    }
    if (!hasText && el.tagName.toLowerCase() !== 'svg') return;

    var col = (cs || getComputedStyle(el)).color;
    if (!isGray(col)) return;                 // 彩色文字保留品牌色

    // covered 由调用方给：包括「自身背景」，因为背景就在字的下面
    if (covered) return;
    el.classList.add(colorLum(col) > 0.16 ? 'pansou-ink-dim' : 'pansou-ink-x');
  }

  /** 自上而下走一遍，把「祖先是否已有底色」顺路带下去，避免每个元素重复爬树 */
  function walkInk(el, covered) {
    var cs = null;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    var selfCovered = covered || hasFill(cs);
    try { paintText(el, selfCovered, cs); } catch (e) {}
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) walkInk(kids[i], selfCovered);
  }

  /**
   * 增量扫描时的起点状态：新插入的节点可能落在卡片内部，
   * 这时它的「上方有没有底」不能假定为 false，得沿祖先爬一遍。
   */
  function ancestorCovered(el) {
    var p = el.parentElement;
    while (p && p !== document.body) {
      try {
        if (hasFill(getComputedStyle(p))) return true;
      } catch (e) {}
      p = p.parentElement;
    }
    return false;
  }

  /** 全量重扫：换壁纸后底色全变了，之前的判定要作废重来 */
  function repaintInk() {
    try {
      if (!ROOT.classList.contains('pansou-wp-on') || !document.body) return;
      var old = document.querySelectorAll('.pansou-ink-x,.pansou-ink-dim');
      for (var i = 0; i < old.length; i++) {
        old[i].classList.remove('pansou-ink-x');
        old[i].classList.remove('pansou-ink-dim');
      }
      // 从 body 的子节点起步：body 自己挂着壁纸背景图，从它算起会把全页当成「有底」
      var kids = document.body.children;
      for (var k = 0; k < kids.length; k++) walkInk(kids[k], false);
    } catch (e) {}
  }

  /** 搜索结果不断插入新卡片：增量补扫，200ms 合并，别拖慢滚动 */
  function queueInk(node) {
    if (!node || node.nodeType !== 1) return;
    inkQueue.push(node);
    if (inkTimer) return;
    inkTimer = setTimeout(function () {
      inkTimer = 0;
      var q = inkQueue;
      inkQueue = [];
      if (!ROOT.classList.contains('pansou-wp-on')) return;
      for (var i = 0; i < q.length; i++) {
        var n = q[i];
        if (!n || n.isConnected === false) continue;
        if (n === document.body) {
          // body 自己挂着壁纸背景图，从它的子节点起步，别把全页判成「有底」
          var ks = n.children;
          for (var j = 0; j < ks.length; j++) walkInk(ks[j], false);
        } else {
          walkInk(n, ancestorCovered(n));
        }
      }
    }, 200);
  }

  try {
    var inkMo = new MutationObserver(function (muts) {
      if (!ROOT.classList.contains('pansou-wp-on')) return;
      for (var i = 0; i < muts.length; i++) {
        var ad = muts[i].addedNodes;
        for (var j = 0; j < ad.length; j++) queueInk(ad[j]);
      }
    });
    inkMo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  /** 把当前配置套到 <html>/<body>：盖背景图 + 让卡片半透明透出 */
  function applyBg() {
    var image = '';
    if (cfg.type === 'custom') {
      image = 'url("' + String(cfg.value).replace(/"/g, '%22') + '")';
    } else if (cfg.type === 'builtin') {
      image = gradCss(cfg.value);
    }

    var css = '';
    if (image) {
      // 深色壁纸自动把文字切成白字，浅色壁纸维持深字
      if (cfg.type === 'custom') {
        if (inkUrl && inkUrl === cfg.value) {
          inkFor(lastLum);                 // 这张图采样过了，直接用结果
        } else {
          inkFor(0.5);                     // 采样完成前的中间值，避免闪一下
          inkFromImage(cfg.value);         // 加载后按实际亮度覆盖
        }
      } else {
        inkFor(gradLum(cfg.value));
      }
      var fixed = DEFAULT.alpha;
      // 深色壁纸下选项卡原本「没有底」，字直接压在壁纸上；补一层跟随明暗的玻璃底，
      // 白字才有落脚处（浅色壁纸则是白底，深字照样可读）。
      var navBg = lastLum < 0.52 ? 'rgba(17,24,39,.5)' : 'rgba(255,255,255,.55)';
      // dataURL / 渐变都盖在 body 上；顶部 fixed 保证滚动时壁纸不动。
      // 搜索框下方那一大片（.app-shell 主体）全透明，壁纸完整露出，不蒙「门板」；
      // 其它卡片/导航栏固定 50% 半透明，不动；只有搜索框 input 用滑块值 cfg.alpha。
      // 壁纸放在独立的 fixed 层（#pansou-wp-layer），body 只保持透明：
      // 直接盖 body 的话，键盘一弹视口变矮，cover 就重新裁切，壁纸会跳。
      css = '#pansou-wp-layer{position:fixed;top:0;left:0;pointer-events:none;z-index:-1;'
          + 'background-repeat:no-repeat;background-position:center center;'
          + 'background-size:cover;background-attachment:scroll;}'
          + 'html.pansou-wp-on body{background-color:transparent!important;'
          + 'background-image:none!important;}'
          /* 那一大片主容器（app-shell 带 bg-background）也全透明，让壁纸透出来 */
          + 'html.pansou-wp-on .app-shell{background-color:transparent!important;}'
          + 'html.pansou-wp-on{--wp-alpha:' + fixed + ';'
          + '--background:0 0% 100% / ' + fixed + '!important;'
          + '--card:0 0% 100% / ' + fixed + '!important;'
          + '--popover:0 0% 100% / ' + fixed + '!important;'
          + '--muted:220 14% 96% / ' + fixed + '!important;'
          + '--secondary:220 14% 96% / ' + fixed + '!important;'
          /* 次要文字从 46% 灰压到 34%：卡片是「半透明白 + 壁纸」的中间调，
             原来的浅灰压在这种底上偏虚，加深一档才读得清 */
          + '--muted-foreground:220 10% 34%!important;'
          + '--secondary-foreground:220 10% 34%!important;'
          + '--text-secondary:220 10% 34%!important;}'
          /* 搜索框单独跟随滑块 alpha（bg-background 的 hsl 写法展开） */
          + 'html.pansou-wp-on input[placeholder*="搜索资源"]{'
          + 'background-color:hsl(0 0% 100% / ' + cfg.alpha + ')!important;'
          /* 搜索框底始终是白的，字就用深色，别跟着壁纸变白糊成一片 */
          + 'color:#0b1220!important;}'
          + 'html.pansou-wp-on input[placeholder*="搜索资源"]::placeholder{'
          /* 框底是「半透明白 + 壁纸」的中间调，占位符用不透明深灰才压得住 */
          + 'color:#2b3441!important;}'
          /* 直接压在壁纸上的文字：主墨色 / 次要墨色，都带方向相反的阴影托底 */
          + 'html.pansou-wp-on .pansou-ink,'
          + 'html.pansou-wp-on .pansou-ink *{color:var(--wp-ink,#0f172a)!important;'
          + 'text-shadow:var(--wp-ink-shadow,0 0 0 transparent)!important;}'
          + 'html.pansou-wp-on .pansou-ink-x{color:var(--wp-ink,#0f172a)!important;'
          + 'text-shadow:var(--wp-ink-shadow,0 0 0 transparent)!important;}'
          + 'html.pansou-wp-on .pansou-ink-dim{color:var(--wp-ink-dim,rgba(15,23,42,.8))!important;'
          + 'text-shadow:var(--wp-ink-shadow,0 0 0 transparent)!important;}'
          /* 顶栏图标（搜索/配置/壁纸）：都是纯描边 svg，stroke=currentColor。
             自动扫描依赖 DOM 变化事件，Vue 复用节点改状态时不会触发，会漏掉个别按钮
             （实测「搜索」按钮就漏了）；这里直接用 CSS 兜底，保证顶栏图标一律跟随墨色。
             带 .active 的按钮是蓝底白图标，保持原样不动。 */
          + 'html.pansou-wp-on button.nav-button:not(.active) svg,'
          + 'html.pansou-wp-on .pansou-wp-launcher svg{color:var(--wp-ink-dim,rgba(15,23,42,.8))!important;}'
          /* 描边同理：浅色壁纸下原来的浅灰边（220 13% 91%）根本看不见，按明暗换成墨色线 */
          + 'html.pansou-wp-on button.nav-button:not(.active),'
          + 'html.pansou-wp-on .pansou-wp-launcher{border-color:var(--wp-line,rgba(15,23,42,.26))!important;}'
          /* 配置页选项卡：补玻璃底衬，格子里的字才有底 */
          + 'html.pansou-wp-on .config-content .tabs-nav{background-color:' + navBg + '!important;}'
          /* 去点阵：前端有两层 .bg-decorative 装饰网格（20px/24px 圆点 + 漂移动画），
             固定在最底层，壁纸一透出来就变成「浮在壁纸上的密密麻麻小点」。
             有壁纸时整层关掉，还壁纸干净画面。 */
          + 'html.pansou-wp-on .bg-decorative{display:none!important;'
          + 'background-image:none!important;animation:none!important;}';
    }

    var st = document.getElementById(STYLE_ID);
    if (!st) {
      st = document.createElement('style');
      st.id = STYLE_ID;
      (document.head || ROOT).appendChild(st);
    }
    st.textContent = css;
    if (image) ROOT.classList.add('pansou-wp-on');
    else ROOT.classList.remove('pansou-wp-on');

    var layer = ensureLayer();
    if (layer) {
      if (image) {
        layer.style.backgroundImage = image;
        layer.style.display = 'block';
        sizeLayer();
      } else {
        layer.style.display = 'none';
      }
    }

    // 换壁纸后明暗变了，重新判定哪些文字要转白/转深（滑块只改透明度，不重扫）
    // dataURL 前 64 字符都是同样的 data:image 前缀，光看前缀区分不出两张不同的图
    var v = String(cfg.value);
    var key = cfg.type + '|' + v.length + '|'
      + (v.length > 64 ? v.slice(0, 16) + v.slice(-16) : v);
    if (key !== lastInkKey) {
      lastInkKey = key;
      repaintInk();
    }

    wlog('已套用 type=' + cfg.type + ' value=' + String(cfg.value).slice(0, 40)
         + ' alpha=' + cfg.alpha);
  }

  /** 面板自己的样式，class 不依赖前端（前端 CSS 带 data-v scope 命中不到我们） */
  function ensurePanelStyle() {
    if (document.getElementById('pansou-wp-css')) return;
    var s = document.createElement('style');
    s.id = 'pansou-wp-css';
    s.textContent = ''
      /* 顶部导航栏壁纸入口：纯图标按钮，样式与前端窄屏 .nav-button 完全一致 */
      + '.pansou-wp-launcher{display:flex;align-items:center;justify-content:center;'
      + 'padding:.5rem;min-width:2.5rem;gap:0;'
      + 'background:transparent;color:hsl(var(--muted-foreground));border:1px solid hsl(var(--border));'
      + 'border-radius:.375rem;font-size:.8rem;font-weight:500;cursor:pointer;transition:all .2s ease;'
      + '-webkit-tap-highlight-color:transparent;}'
      + '.pansou-wp-launcher:hover,.pansou-wp-launcher:active{background:hsl(var(--accent));color:hsl(var(--accent-foreground));border-color:hsl(var(--accent));}'
      + '.pansou-wp-launcher .nav-icon{display:flex;align-items:center;justify-content:center;flex-shrink:0;line-height:0;}'
      /* 图标尺寸对齐前端头部 nav-button 的 w-5 h-5（20px）；
         照片图标是宽矩形、本身比齿轮矮，再放大一档做视觉配平 */
      + '.pansou-wp-launcher svg{width:1.35rem;height:1.35rem;display:block;}'
      /* 弹出浮层：遮罩 + 居中卡片 */
      + '.pansou-wp-mask{position:fixed;inset:0;z-index:9998;background:rgba(15,23,42,.45);'
      + 'display:none;align-items:center;justify-content-center;padding:18px;'
      + '-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}'
      + '.pansou-wp-dialog{width:100%;max-width:420px;max-height:85vh;overflow-y:auto;'
      + 'background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:14px;'
      + 'box-shadow:0 18px 50px rgba(15,23,42,.28);padding:18px 20px 20px;}'
      + '.pansou-wp-dialog-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}'
      + '.pansou-wp-dialog-h b{font-size:16px;color:hsl(var(--foreground));font-weight:700;}'
      + '.pansou-wp-dialog-h span{font-size:12px;color:hsl(var(--muted-foreground));margin-left:8px;font-weight:400;}'
      + '.pansou-wp-x{width:28px;height:28px;border:none;border-radius:50%;background:hsl(var(--muted));'
      + 'color:hsl(var(--muted-foreground));font-size:19px;line-height:1;cursor:pointer;}'
      + '.pansou-wp-grid{display:flex;flex-wrap:wrap;gap:8px;}'
      + '.pansou-wp-thumb{width:52px;height:40px;border-radius:7px;cursor:pointer;'
      + 'border:2px solid transparent;background-size:cover;background-position:center;'
      + 'position:relative;-webkit-tap-highlight-color:transparent;}'
      + '.pansou-wp-thumb.sel{border-color:hsl(var(--primary));box-shadow:0 0 0 2px hsl(var(--primary) / .25);}'
      + '.pansou-wp-thumb[data-wp="none"]{background:#f1f5f9 url("data:image/svg+xml;utf8,'
      + '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'20\' height=\'20\' viewBox=\'0 0 24 24\' '
      + 'fill=\'none\' stroke=\'%2394a3b8\' stroke-width=\'2\'%3E%3Cpath d=\'M18 6 6 18M6 6l12 12\'/%3E%3C/svg%3E")'
      + ' center/16px no-repeat;}'
      + '.pansou-wp-thumb[data-wp="custom-empty"]{background:#eef2ff url("data:image/svg+xml;utf8,'
      + '%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'22\' height=\'22\' viewBox=\'0 0 24 24\' '
      + 'fill=\'none\' stroke=\'%236366f1\' stroke-width=\'2\'%3E%3Cpath d=\'M12 5v14M5 12h14\'/%3E%3C/svg%3E")'
      + ' center/18px no-repeat;}'
      + '.pansou-wp-thumb i{position:absolute;left:0;right:0;bottom:-1px;text-align:center;'
      + 'font-size:9px;font-style:normal;color:#334155;background:rgba(255,255,255,.82);'
      + 'border-radius:0 0 5px 5px;line-height:13px;}'
      + '.pansou-wp-row{display:flex;align-items:center;gap:10px;margin-top:14px;flex-wrap:wrap;}'
      + '.pansou-wp-row label{font-size:13px;color:hsl(var(--foreground));white-space:nowrap;}'
      + '.pansou-wp-row input[type=range]{flex:1;min-width:120px;accent-color:hsl(var(--primary));}'
      + '.pansou-wp-btn{padding:7px 14px;border:1px solid hsl(var(--border));border-radius:7px;'
      + 'background:hsl(var(--card));color:hsl(var(--foreground));font-size:13px;cursor:pointer;}'
      + '.pansou-wp-btn.pri{background:hsl(var(--primary));color:#fff;border-color:hsl(var(--primary));}'
      + '.pansou-wp-alpha-val{font-size:12px;color:hsl(var(--muted-foreground));min-width:34px;text-align:right;}';
    (document.head || ROOT).appendChild(s);
  }

  /** 生成配置面板 DOM（不塞 dataURL 进 innerHTML，缩略图用 style 赋值） */
  function buildPanel() {
    var box = document.createElement('div');
    box.id = PANEL_ID;

    var grid = document.createElement('div');
    grid.className = 'pansou-wp-grid';
    GRADS.forEach(function (g) {
      var t = document.createElement('div');
      t.className = 'pansou-wp-thumb';
      t.setAttribute('data-wp', g.id);
      t.title = g.name;
      if (g.css) t.style.backgroundImage = g.css;
      var lab = document.createElement('i');
      lab.textContent = g.name;
      t.appendChild(lab);
      t.addEventListener('click', function () {
        cfg.type = 'builtin';
        cfg.value = g.id;
        try { NATIVE.setBuiltin(g.id, cfg.alpha); } catch (e) {}
        applyBg();
        syncThumb();
      });
      grid.appendChild(t);
    });
    box.appendChild(grid);

    var rows = document.createElement('div');
    rows.className = 'pansou-wp-row';
    var lab = document.createElement('label');
    lab.textContent = '搜索框通透度';
    var range = document.createElement('input');
    range.type = 'range';
    range.min = '0';
    range.max = '100';
    range.value = String(Math.round(cfg.alpha * 100));
    var val = document.createElement('span');
    val.className = 'pansou-wp-alpha-val';
    val.textContent = range.value + '%';
    range.addEventListener('input', function () {
      cfg.alpha = (parseInt(range.value, 10) || 0) / 100;
      val.textContent = range.value + '%';
      try {
        // 只改通透度。自定义图动辄几百 KB，滑块每动一下都重写图片文件会卡死
        if (typeof NATIVE.setAlpha === 'function') {
          NATIVE.setAlpha(cfg.alpha);
        } else if (cfg.type === 'custom') {
          NATIVE.setCustom(cfg.value, cfg.alpha);
        } else {
          NATIVE.setBuiltin(cfg.value, cfg.alpha);
        }
      } catch (e) {}
      applyBg();
    });
    rows.appendChild(lab);
    rows.appendChild(range);
    rows.appendChild(val);
    box.appendChild(rows);

    var bar = document.createElement('div');
    bar.className = 'pansou-wp-row';
    var pick = document.createElement('button');
    pick.className = 'pansou-wp-btn pri';
    pick.textContent = '从相册选择';
    pick.addEventListener('click', function () {
      try { NATIVE.pickImage(); } catch (e) { wlog('选图失败: ' + e); }
    });
    var reset = document.createElement('button');
    reset.className = 'pansou-wp-btn';
    reset.textContent = '恢复默认';
    reset.addEventListener('click', function () {
      cfg.type = DEFAULT.type;
      cfg.value = DEFAULT.value;
      cfg.alpha = DEFAULT.alpha;
      try { NATIVE.setBuiltin(DEFAULT.value, DEFAULT.alpha); } catch (e) {}
      range.value = String(Math.round(DEFAULT.alpha * 100));
      val.textContent = range.value + '%';
      applyBg();
      syncThumb();
    });
    bar.appendChild(pick);
    bar.appendChild(reset);
    box.appendChild(bar);

    // “用户自定义”卡片：固定显示，和内置壁纸并列。
    //   没选过图 → 显示 + 占位，点选进相册
    //   选过图   → 显示该图缩略图，点选把记住的自定义图保存并应用
    var ct = document.createElement('div');
    ct.className = 'pansou-wp-thumb';
    var hasCustom = !!(cfg.custom || (cfg.type === 'custom' && cfg.value));
    if (hasCustom) {
      var pic = cfg.custom || cfg.value;
      ct.setAttribute('data-wp', 'custom');
      ct.title = '应用自定义壁纸';
      ct.style.backgroundImage = 'url("' + String(pic).replace(/"/g, '%22') + '")';
      ct.addEventListener('click', function () {
        cfg.type = 'custom';
        cfg.value = pic;
        try { NATIVE.applyCustom(cfg.alpha); } catch (e) {}
        applyBg();
        syncThumb();
      });
    } else {
      ct.setAttribute('data-wp', 'custom-empty');
      ct.title = '从相册选一张自定义壁纸';
      ct.addEventListener('click', function () {
        try { NATIVE.pickImage(); } catch (e) { wlog('选图失败: ' + e); }
      });
    }
    var ci = document.createElement('i');
    ci.textContent = '自定义';
    ct.appendChild(ci);
    grid.appendChild(ct);

    syncThumb();
    return box;
  }

  function syncThumb() {
    var box = document.getElementById(PANEL_ID);
    if (!box) return;
    var all = box.querySelectorAll('.pansou-wp-thumb');
    for (var i = 0; i < all.length; i++) {
      var wp = all[i].getAttribute('data-wp');
      var on = (wp === 'custom' && cfg.type === 'custom')
        || (wp !== 'custom' && wp !== 'custom-empty' && wp === cfg.value);
      if (on) all[i].classList.add('sel');
      else all[i].classList.remove('sel');
    }
  }

  var MASK_ID = 'pansou-wp-mask';
  var LAUNCHER_ID = 'pansou-wp-launcher';

  /** 打开壁纸浮层（懒建，重复点不重复生成） */
  function openPanel() {
    ensurePanelStyle();
    var mask = document.getElementById(MASK_ID);
    if (!mask) {
      mask = document.createElement('div');
      mask.id = MASK_ID;
      mask.className = 'pansou-wp-mask';

      var dlg = document.createElement('div');
      dlg.className = 'pansou-wp-dialog';

      var head = document.createElement('div');
      head.className = 'pansou-wp-dialog-h';
      var title = document.createElement('b');
      title.textContent = '界面壁纸';
      var hint = document.createElement('span');
      hint.textContent = '点选即生效';
      head.appendChild(title);
      head.appendChild(hint);
      var x = document.createElement('button');
      x.className = 'pansou-wp-x';
      x.setAttribute('aria-label', '关闭');
      x.textContent = '×';
      x.addEventListener('click', closePanel);
      head.appendChild(x);
      dlg.appendChild(head);
      dlg.appendChild(buildPanel());
      mask.appendChild(dlg);
      // 点遮罩空白处关闭（点在卡片内不关）
      mask.addEventListener('click', function (e) {
        if (e.target === mask) closePanel();
      });
      (document.body || ROOT).appendChild(mask);
    } else {
      syncThumb();
    }
    mask.style.display = 'flex';
    wlog('壁纸浮层已打开');
  }

  function closePanel() {
    var mask = document.getElementById(MASK_ID);
    if (mask) mask.style.display = 'none';
  }

  /** 把壁纸入口按钮插到顶部导航栏「配置」按钮的右边 */
  function mountLauncher() {
    if (document.getElementById(LAUNCHER_ID)) return;
    var cfgBtn = document.querySelector('button[title="配置"]');
    if (!cfgBtn || !cfgBtn.parentNode) return;
    // 样式必须在建按钮之前注入：以前只在打开弹窗时才注入，
    // 导致入口按钮在启动时是「无样式」状态（没边框、图标黑色且偏小）。
    ensurePanelStyle();
    var b = document.createElement('button');
    b.id = LAUNCHER_ID;
    b.className = 'pansou-wp-launcher';
    b.title = '界面壁纸';
    // 图标换成填充更满的 heroicons photo：旧图四周留白大，同尺寸下看着比齿轮小一圈
    b.innerHTML = '<span class="nav-icon"><svg fill="none" stroke="currentColor" '
      + 'viewBox="0 0 24 24" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159'
      + 'm-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909'
      + 'm-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Z"/>'
      + '<path d="M12.75 8.25h.008v.008h-.008V8.25Z" stroke-width="2"/>'
      + '</svg></span>';
    b.addEventListener('click', openPanel);
    cfgBtn.parentNode.insertBefore(b, cfgBtn.nextSibling);
    wlog('壁纸入口已插入配置按钮右侧');
  }

  // 原生选图完成回调：新 dataURL 已落盘，这里只更新内存态 + 重新套用 + 重建面板
  window.PansouWallpaper = {
    onImagePicked: function (dataUrl, alpha) {
      cfg.type = 'custom';
      cfg.value = dataUrl;
      cfg.custom = dataUrl;
      cfg.alpha = typeof alpha === 'number' ? alpha : cfg.alpha;
      applyBg();
      var old = document.getElementById(PANEL_ID);
      if (old && old.parentNode) old.parentNode.removeChild(old);
      // 浮层开着就重建面板内容，让「用户自定义」卡片显示刚选的图
      var mask = document.getElementById(MASK_ID);
      if (mask && mask.style.display === 'flex') {
        var dlg = mask.querySelector('.pansou-wp-dialog');
        if (dlg) dlg.appendChild(buildPanel());
      }
    }
  };

  // 启动：读原生配置 → 套背景
  try {
    var raw = NATIVE.getConfig();
    if (raw) {
      var o = JSON.parse(raw);
      if (o && o.type) {
        cfg.type = o.type;
        cfg.value = o.value || DEFAULT.value;
        cfg.alpha = typeof o.alpha === 'number' ? o.alpha : DEFAULT.alpha;
        cfg.custom = o.custom || '';
      }
    }
  } catch (e) {
    wlog('读配置失败，用默认: ' + e);
  }
  applyBg();

  // 脚本在 <body> 解析前执行，顶部栏还没渲染；盯着 DOM，配置按钮一出现就在其右侧插入入口
  try {
    var wpMo = new MutationObserver(function () { mountLauncher(); });
    wpMo.observe(document.documentElement, { childList: true, subtree: true });
    mountLauncher();
  } catch (e) {
    setInterval(mountLauncher, 1500);
  }

  // ESC 关闭浮层
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) closePanel();
  }, true);
})();

/* ==================================================================
 * 隐藏搜索主页的“输入关键词开始搜索”空状态卡片。
 * 前端是压缩 Vue，直接改不动；这里注入一条 CSS，靠 .empty-title 的
 * 文字把它的父容器 .empty-state 精准隐藏，不影响“搜索无结果”等其他状态。
 * Vue 反复重建 DOM，用 MutationObserver 反复补刀。
 * ================================================================== */
(function () {
  var CSS_ID = 'pansou-hide-empty-css';
  var marker = '输入关键词开始搜索';

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    // 高特异性 + !important，盖过前端带 data-v scope 的样式
    s.textContent = 'html body .empty-state:has(> .empty-icon + .empty-title),'
      + 'html body div.empty-state:has(.empty-title){display:none!important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  // 老 WebView 可能不支持 :has()，这里兜底：直接给命中文字的父节点加内联 style
  function hideDirect() {
    var titles = document.querySelectorAll('.empty-title');
    for (var i = 0; i < titles.length; i++) {
      if (String(titles[i].textContent || '').indexOf(marker) >= 0) {
        var box = titles[i].parentNode;
        if (box && box.style) box.style.display = 'none';
      }
    }
  }

  function apply() {
    ensureCss();
    hideDirect();
  }

  try {
    var mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  apply();
})();

/* ==================================================================
 * 顶部左上角 logo 方块（PanSou 标题左侧的放大镜）改为黑底。
 * 精准定位：h1 文案恰为 "PanSou" 的父容器里那个 .w-8.h-8.bg-primary 方块，
 * 避免误伤右上角蓝色搜索按钮（同样是 bg-primary）。
 * ================================================================== */
(function () {
  var CSS_ID = 'pansou-logo-black-css';
  var CLS = 'pansou-logo-black';

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    // 高特异性 + !important，盖过前端带 data-v scope 的样式
    s.textContent = 'html body .' + CLS + '{background:#000!important;}'
      // 直接坐在壁纸上的文字（页标题、副标题、页脚）跟随 --wp-ink 换色；
      // 卡片内部文字不动——卡片是半透明白底，深字才读得清。
      + 'html.pansou-wp-on h1.config-title,'
      + 'html.pansou-wp-on .config-subtitle,'
      + 'html.pansou-wp-on footer{color:var(--wp-ink,#0f172a)!important;'
      + 'text-shadow:var(--wp-ink-shadow,0 0 0 transparent)!important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function paint() {
    ensureCss();
    var hs = document.querySelectorAll('h1');
    for (var i = 0; i < hs.length; i++) {
      if (String(hs[i].textContent || '').trim() !== 'PanSou') continue;
      // 标题文字：壁纸偏暗时由壁纸脚本的 --wp-ink 变量转成白字
      hs[i].classList.add('pansou-ink');
      // h1 -> div(标题) -> div.flex.items-center.gap-3.cursor-pointer
      var box = hs[i].parentNode && hs[i].parentNode.parentNode;
      if (!box) continue;
      var logo = box.querySelector('.w-8.h-8.bg-primary');
      if (logo) logo.classList.add(CLS);
    }
  }

  try {
    var mo = new MutationObserver(paint);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  paint();
})();

/* ==================================================================
 * 隐藏顶部导航栏右上角的「API 文档」按钮：一般用户用不到。
 * 精准定位 title="API文档" 的 nav-button；再用 JS 按 nav-text 文案兜底，
 * 兼容老 WebView 未把 title 渲染出来的情况。Vue 反复重建 DOM 用 observer 补刀。
 * ================================================================== */
(function () {
  var CSS_ID = 'pansou-hide-api-css';
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = 'html body button[title="API文档"]{display:none!important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function hideDirect() {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      if (b.getAttribute && b.getAttribute('title') === 'API文档') {
        b.style.display = 'none';
        continue;
      }
      // 兜底：按钮里有 nav-text 文案恰为 "API"
      var txt = b.querySelector('.nav-text');
      if (txt && String(txt.textContent || '').trim() === 'API') {
        b.style.display = 'none';
      }
    }
  }

  function apply() { ensureCss(); hideDirect(); }

  try {
    var mo = new MutationObserver(apply);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  apply();
})();

/* ==================================================================
 * 搜索结果顺序稳定化。
 *
 * PanSou 是「边搜边出」的：后端每次推送都会整体替换结果数组，前端又按
 * 链接检测状态重排（刚检测完的链接优先级最高，立刻跳到列表最前面）。
 * 结果用户一边下滑一边看到列表不断洗牌，正在看的内容被挪走。
 *
 * 这里拦截 /search 的响应，按「首次出现顺序」重排各网盘类型的数组：
 * 已经出现过的条目保持原有先后，新搜到的条目一律追加到末尾。
 * 只动顺序、不动内容，不改前端 bundle。
 * ================================================================== */
(function () {
  var proto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
  if (!proto) return;
  var desc = Object.getOwnPropertyDescriptor(proto, 'responseText');
  if (!desc || !desc.get) return;

  // 每种网盘类型各自维护：已出现过的链接顺序 + 每条的最新数据
  var order = {};   // 类型 -> [链接key, ...]
  var items = {};   // 类型 -> { 链接key: 最新条目 }
  var known = {};   // 类型 -> { 链接key: 1 }（查重用）
  var lastKw = null;
  var lastRespAt = 0;   // 上一次响应时间，用来识别「用户重新发起了一轮搜索」

  function isArr(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  /**
   * 链接身份：同一资源必须稳定命中同一个 key，否则每次响应都会被当成新条目，
   * 顺序表重建 = 用户看到的「边滑边洗牌」。
   * 真机后端的不同来源/插件会给同一链接加不同尾巴（?spm=xxx、?entry=、#fragment、
   * 大小写不同的 host、末尾斜杠），裸用 url 字符串比对必然抖动，这里先归一化。
   */
  function keyOf(it) {
    if (!it || typeof it !== 'object') return '';
    var k = it.url || it.normalized_url;
    if (!k) return String(it.note || '') + '|' + String(it.datetime || '');
    k = String(k);
    var hash = k.indexOf('#');
    if (hash >= 0) k = k.slice(0, hash);
    var q = k.indexOf('?');
    if (q >= 0) k = k.slice(0, q);          // 跟踪参数/提取码参数不参与身份判定
    k = k.replace(/\/+$/, '');              // 末尾斜杠
    k = k.replace(/^https?:\/\//i, '');     // 协议差异
    var slash = k.indexOf('/');
    if (slash > 0) k = k.slice(0, slash).toLowerCase() + k.slice(slash);
    return k;
  }

  // 从请求地址里取关键词；换词就重新记顺序
  function kwOf(url) {
    var i = String(url).indexOf('?');
    if (i < 0) return null;
    var parts = String(url).slice(i + 1).split('&');
    for (var j = 0; j < parts.length; j++) {
      var kv = parts[j].split('=');
      if (kv[0] === 'kw') {
        try { return decodeURIComponent(kv[1] || ''); } catch (e) { return kv[1] || ''; }
      }
    }
    return null;
  }

  function resetAll() {
    order = {};
    items = {};
    known = {};
  }

  // 只增不减的稳定合并：
  //   老链接保持原位（内容用本次最新数据覆盖），新链接一律追加到末尾。
  //   这样界面上「已看到的条目」永远不会挪位，新搜到的结果从后面长出来。
  //   何时重建顺序由 rewrite() 决定（换关键词 / 隔了很久重新搜），不在这里猜。
  function mergeStable(mbt) {
    if (!mbt || typeof mbt !== 'object') return;

    var out = {};
    var t, i, k;

    for (t in mbt) {
      if (!Object.prototype.hasOwnProperty.call(mbt, t)) continue;
      var arr = mbt[t];
      if (!isArr(arr)) { out[t] = arr; continue; }

      var ord = order[t] || (order[t] = []);
      var map = items[t] || (items[t] = {});
      var kn = known[t] || (known[t] = {});

      for (i = 0; i < arr.length; i++) {
        k = keyOf(arr[i]);
        if (!k) continue;                 // 连 url/标题都没有的条目，原样丢弃
        map[k] = arr[i];                  // 用最新数据覆盖
        if (!kn[k]) { kn[k] = 1; ord.push(k); }
      }

      var res = [];
      for (i = 0; i < ord.length; i++) {
        if (map[ord[i]]) res.push(map[ord[i]]);
      }
      out[t] = res;
    }

    // 本次响应里没出现、但之前出现过的网盘类型也要保留，避免整块 tab 忽隐忽现
    for (t in order) {
      if (!Object.prototype.hasOwnProperty.call(order, t)) continue;
      if (out[t]) continue;
      var o2 = order[t];
      var r2 = [];
      for (i = 0; i < o2.length; i++) {
        if (items[t][o2[i]]) r2.push(items[t][o2[i]]);
      }
      if (r2.length) out[t] = r2;
    }

    for (t in out) {
      if (Object.prototype.hasOwnProperty.call(out, t)) mbt[t] = out[t];
    }
    for (t in mbt) {
      if (Object.prototype.hasOwnProperty.call(mbt, t) && !out[t]) delete mbt[t];
    }
  }

  function rewrite(raw, url) {
    var kw = kwOf(url);
    var now = Date.now();
    // 会话边界只有两种：换了关键词，或距离上一次响应超过 20 秒（用户重新点了一次搜索）。
    // 绝不能用「新链接占比高」来判断：真机后端每批响应的来源集合可能完全不同
    // （或同一链接带不同跟踪参数），分批到达时新链接占比轻松超过 80%，
    // 会把同一轮搜索误判成新搜索，整表重排 —— 这就是「边滑边洗牌」的根源。
    var reset = (kw !== lastKw || now - lastRespAt > 20000);
    if (reset) resetAll();
    lastKw = kw;
    lastRespAt = now;
    var o = JSON.parse(raw);
    var p = o && o.data ? o.data : o;
    if (!p || !p.merged_by_type) return raw;
    var before = (p.merged_by_type.quark || []).length;
    mergeStable(p.merged_by_type);
    // 诊断行：真机出问题时 `adb logcat -s PansouWeb` 就能看到每次响应有没有重建顺序
    mlog('kw=' + kw + ' reset=' + (reset ? 1 : 0) + ' 夸克 ' + before + '->'
         + (p.merged_by_type.quark || []).length);
    return JSON.stringify(o);
  }

  function mlog(m) {
    try { console.log('[PansouMerge] ' + m); } catch (e) {}
    // console 在部分 ROM 上收不到，再走一层原生桥落 logcat
    try {
      var nb = window.PansouNative;
      if (nb && nb.log) nb.log('[merge] ' + m);
    } catch (e) {}
  }

  var origOpen = proto.open;
  proto.open = function (m, u) {
    try { this.__psUrl = String(u || ''); } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  try {
    Object.defineProperty(proto, 'responseText', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () {
        var raw = desc.get.call(this);
        try {
          if (this.readyState !== 4) return raw;
          var url = this.__psUrl;
          if (!url || url.indexOf('/search') < 0) return raw;
          if (this.__psRaw === raw) return this.__psOut;   // 同一次响应只改一次
          this.__psRaw = raw;
          this.__psOut = rewrite(raw, url);
          return this.__psOut;
        } catch (e) {
          return raw;
        }
      }
    });
  } catch (e) {}
})();

/* ==================================================================
 * 窄屏横向溢出修复。
 *
 * 搜索页（.search-page）是 CSS Grid，列宽未显式声明，默认 auto 列会被
 * 内容的 min-content 顶宽。统计栏里「结果 / 类型 / 用时」三个标签是
 * white-space:nowrap 且 flex-shrink:0，加起来最小需要 366px，而 360dp
 * 手机（1080÷3）容器只有 328px —— 于是整列被撑到 366px，
 * 搜索框右侧的搜索按钮、结果栏的下载按钮、结果卡片右边缘全部被裁出屏幕。
 *
 * 411dp 的平板/大屏不会触发，所以只在窄屏手机上暴露。
 *
 * 修法：强制 grid 列不超过容器（minmax(0,1fr)），给所有子项 min-width:0
 * 允许收缩；统计栏标签改为可收缩 + 允许换行兜底，避免「用时」压到按钮上。
 * ================================================================== */
(function () {
  var ID = 'pansou-layout-fix';
  function ensureCss() {
    if (document.getElementById(ID)) return;
    var s = document.createElement('style');
    s.id = ID;
    s.textContent = [
      /* 核心：grid 列宽不允许被内容撑破 */
      'html body .search-page{grid-template-columns:minmax(0,1fr)!important;}',
      'html body .search-page>*{min-width:0!important;}',
      /* 统计栏：标签可收缩，间距收紧，放不下时换行而不是叠到按钮上 */
      'html body .stats-layout{padding:.5rem .6rem!important;gap:.5rem!important;}',
      'html body .stats-metrics{flex-wrap:wrap!important;gap:.25rem .5rem!important;padding-right:0!important;}',
      'html body .stats-chip{flex-shrink:1!important;min-width:0!important;gap:.2rem!important;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  ensureCss();
  /* Vue 重建 DOM 时 style 标签不会丢，但保险起见跟随一次 */
  try {
    var mo = new MutationObserver(ensureCss);
    mo.observe(document.documentElement, { childList: true, subtree: false });
  } catch (e) {}
})();

/* ==================================================================
 * 配置页选项卡 → 2×2 田字格。
 *
 * 原样式 .tabs-nav 是 flex 横排，四个按钮（TG频道/搜索插件/网盘类型/检测）
 * 挤在 360dp 宽度里，每个只剩 ~87px，「搜索插件」这种四个字被压得很难看，
 * 且「检测」后面的「已开启」徽标几乎贴边。
 *
 * 改成 CSS Grid 两列两行：上排放常用的「网盘类型 / 检测」，下排放
 * 「TG频道 / 搜索插件」。位置用 order 调整（DOM 顺序不变，只改视觉顺序），
 * 这样 Vue 的 active 切换逻辑完全不受影响。
 * ================================================================== */
(function () {
  var ID = 'pansou-config-grid';
  var SCOPE = 'html body .config-content .tabs-nav';
  function ensureCss() {
    if (document.getElementById(ID)) return;
    var s = document.createElement('style');
    s.id = ID;
    s.textContent = [
      /* 容器：两列网格，去掉横向滚动，四格等宽；下沿用直角与内容面板贴合 */
      SCOPE + '{display:grid!important;grid-template-columns:1fr 1fr!important;'
        + 'grid-auto-flow:row!important;gap:.5rem!important;padding:.5rem!important;'
        + 'overflow:visible!important;border-radius:.75rem .75rem 0 0!important;}',
      /* 格子：填满单元格，内容横排居中 */
      SCOPE + '>.tab-button{width:auto!important;min-width:0!important;flex:0 0 auto!important;'
        + 'display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;'
        + 'align-items:center!important;justify-content:center!important;gap:.4rem!important;'
        + 'padding:.7rem .5rem!important;border-radius:.6rem!important;}',
      /* 视觉顺序：1 网盘类型 2 检测 / 3 TG频道 4 搜索插件 */
      SCOPE + '>.tab-button:nth-child(3){order:1!important;}',
      SCOPE + '>.tab-button:nth-child(4){order:2!important;}',
      SCOPE + '>.tab-button:nth-child(1){order:3!important;}',
      SCOPE + '>.tab-button:nth-child(2){order:4!important;}',
      /* 选中态：淡蓝底 + 蓝描边，格子大只靠文字变色认不出来 */
      SCOPE + '>.tab-button.active{background:hsl(var(--primary)/.22)!important;'
        + 'box-shadow:inset 0 0 0 1.5px hsl(var(--primary)/.8)!important;}',
      /* 未选中标签：跟随壁纸明暗（深壁纸白字 / 浅壁纸深灰），带阴影托底 */
      SCOPE + '>.tab-button:not(.active) .tab-label{color:var(--wp-ink-dim,#4b5563)!important;'
        + 'text-shadow:var(--wp-ink-shadow,0 0 0 transparent)!important;}',
      /* 文字与徽标：统一行高，四格高度才一致 */
      SCOPE + '>.tab-button .tab-label{white-space:nowrap!important;font-size:.85rem!important;'
        + 'line-height:1.25rem!important;}',
      SCOPE + '>.tab-button .tab-count,' + SCOPE + '>.tab-button .tab-status{'
        + 'flex:0 0 auto!important;display:inline-flex!important;align-items:center!important;'
        + 'height:1.25rem!important;font-size:.7rem!important;padding:0 .35rem!important;'
        + 'line-height:1!important;text-shadow:var(--wp-ink-shadow,0 0 0 transparent)!important;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }
  ensureCss();
  /* 配置页是 Vue 按需渲染的，DOM 重建后 style 标签仍在，这里再兜一次 */
  try {
    var mo = new MutationObserver(ensureCss);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
