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

  function syncUpdate() {
    if (!updateInfo || syncing) return;
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
