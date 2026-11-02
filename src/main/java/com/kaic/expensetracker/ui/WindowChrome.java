package com.kaic.expensetracker.ui;

import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import com.sun.jna.ptr.IntByReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.awt.Window;
import java.util.Locale;

/**
 * The colour of the Windows title bar (the strip with minimise, maximise and close). Windows draws it, not the page, so
 * the program asks the desktop window manager for the dark version when the dark theme is on. Windows 10 (1809 and later)
 * and Windows 11; on other systems nothing happens.
 */
final class WindowChrome {

    private static final Logger log = LoggerFactory.getLogger(WindowChrome.class);
    private static final int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    /** SWP_NOSIZE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED: redraws the frame without moving anything. */
    private static final int REDRAW_FRAME = 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020;
    private static final boolean WINDOWS = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");

    /** The one function used from the desktop window manager library. */
    public interface Dwm extends Library {
        int DwmSetWindowAttribute(Pointer hwnd, int attribute, IntByReference value, int size);
    }

    /** Used only to make Windows repaint the title bar after the change (it does not repaint it by itself at start-up). */
    public interface User32 extends Library {
        boolean SetWindowPos(Pointer hwnd, Pointer after, int x, int y, int cx, int cy, int flags);
    }

    private WindowChrome() {
    }

    static void setDark(Window window, boolean dark) {
        if (!WINDOWS || window == null || !window.isDisplayable()) {
            return;
        }
        try {
            Pointer hwnd = Native.getWindowPointer(window);
            Native.load("dwmapi", Dwm.class).DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE,
                    new IntByReference(dark ? 1 : 0), Integer.BYTES);
            Native.load("user32", User32.class).SetWindowPos(hwnd, null, 0, 0, 0, 0, REDRAW_FRAME);
        } catch (Throwable e) {
            log.debug("Barra de titulo escura indisponivel", e);
        }
    }
}
