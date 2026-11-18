package com.maomao.pansou;

import android.view.WindowInsets;

/**
 * API 30+ 才有的 WindowInsets.Type / android.graphics.Insets 的取用入口。
 *
 * 单独放一个类，是为了让它只在 Build.VERSION.SDK_INT >= 30 时被调用、被加载；
 * 直接写在 MainActivity 里的话，低版本 ROM 在类校验阶段找不到
 * android.graphics.Insets 会直接崩。
 */
final class InsetsCompat {

    private InsetsCompat() {}

    /**
     * 返回 {top, bottom}，单位像素。
     * top 取状态栏与刘海；bottom 取系统栏与输入法的较大值——有的 ROM 在
     * edge-to-edge 下不缩窗口，只通过 ime inset 告知键盘高度。
     */
    static int[] systemBars(WindowInsets in) {
        android.graphics.Insets bars = in.getInsets(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
        android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
        return new int[]{bars.top, Math.max(bars.bottom, ime.bottom)};
    }
}
