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
   * 检测开关单独即时落盘。
   * 配置页的「保存配置」按钮在面板最底下，中间一大片空白，不滚到底根本看不见，
   * 用户点完开关以为已经生效，实际什么都没存——重启自然打回原状。
   * 这个开关只有开/关两种状态，没有中间态要暂存，所以点一下就存，符合直觉。
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
})();
