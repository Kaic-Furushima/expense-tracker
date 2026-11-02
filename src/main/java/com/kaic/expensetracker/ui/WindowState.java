package com.kaic.expensetracker.ui;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.awt.Rectangle;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

/**
 * What the window remembers between runs, in {@code window.properties} next to the data (E7): its size and position, and
 * the theme the page was using, so the loading screen can match it before the page exists. A file that is missing,
 * unreadable or describes a window too small to use is ignored, so the program always opens.
 */
public final class WindowState {

    private static final Logger log = LoggerFactory.getLogger(WindowState.class);
    static final int MIN_WIDTH = 480;
    static final int MIN_HEIGHT = 320;

    private final Path file;
    private Rectangle bounds;
    private boolean dark;

    public WindowState(Path file) {
        this.file = file;
        Properties p = read(file);
        this.bounds = bounds(p);
        this.dark = "true".equals(p.getProperty("dark"));
    }

    /** The saved bounds, or null when there are none (or they are not usable). */
    public Rectangle bounds() {
        return bounds == null ? null : new Rectangle(bounds);
    }

    public void remember(Rectangle rectangle) {
        if (usable(rectangle)) {
            bounds = new Rectangle(rectangle);
        }
    }

    /** The theme the page used last time (false when none was saved). */
    public boolean dark() {
        return dark;
    }

    public void rememberDark(boolean dark) {
        this.dark = dark;
    }

    public void save() {
        Properties p = new Properties();
        if (bounds != null) {
            p.setProperty("x", String.valueOf(bounds.x));
            p.setProperty("y", String.valueOf(bounds.y));
            p.setProperty("width", String.valueOf(bounds.width));
            p.setProperty("height", String.valueOf(bounds.height));
        }
        p.setProperty("dark", String.valueOf(dark));
        try {
            Files.createDirectories(file.toAbsolutePath().getParent());
            try (Writer out = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                p.store(out, "Expense Tracker: tamanho, posição e tema da janela (não editar à mão)");
            }
        } catch (IOException e) {
            log.warn("Não foi possível guardar o estado da janela", e);
        }
    }

    static boolean usable(Rectangle r) {
        return r != null && r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT;
    }

    private static Properties read(Path file) {
        Properties p = new Properties();
        if (!Files.isRegularFile(file)) {
            return p;
        }
        try (Reader in = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            p.load(in);
        } catch (IOException | RuntimeException e) {
            log.warn("Estado da janela ignorado: arquivo inválido", e);
            return new Properties();
        }
        return p;
    }

    private static Rectangle bounds(Properties p) {
        try {
            Rectangle r = new Rectangle(
                    Integer.parseInt(p.getProperty("x", "0").trim()),
                    Integer.parseInt(p.getProperty("y", "0").trim()),
                    Integer.parseInt(p.getProperty("width", "0").trim()),
                    Integer.parseInt(p.getProperty("height", "0").trim()));
            return usable(r) ? r : null;
        } catch (RuntimeException e) {
            log.warn("Tamanho da janela ignorado: valor inválido", e);
            return null;
        }
    }
}
