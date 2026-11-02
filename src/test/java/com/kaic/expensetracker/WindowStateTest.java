package com.kaic.expensetracker;

import com.kaic.expensetracker.ui.WindowState;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.awt.Rectangle;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** The window's remembered size and position (E7): kept across runs, and ignored when unusable. */
class WindowStateTest {

    @TempDir
    Path folder;

    @Test
    void theSizeAndPositionComeBackTheNextTime() {
        Path file = folder.resolve("window.properties");
        WindowState first = new WindowState(file);
        assertNull(first.bounds(), "sem arquivo, nada a restaurar");

        first.remember(new Rectangle(120, 80, 1000, 700));
        first.save();

        assertEquals(new Rectangle(120, 80, 1000, 700), new WindowState(file).bounds());
    }

    @Test
    void aTooSmallWindowIsNotRemembered() {
        WindowState state = new WindowState(folder.resolve("window.properties"));
        state.remember(new Rectangle(0, 0, 200, 100));

        assertNull(state.bounds());
    }

    @Test
    void aBrokenFileIsIgnoredAndTheProgramStillOpens() throws Exception {
        Path file = folder.resolve("window.properties");
        Files.writeString(file, "x=abc\nwidth=1000\nheight=700\n");

        assertNull(new WindowState(file).bounds());
    }

    @Test
    void theThemeTheWindowUsedComesBackBeforeThePageLoads() {
        Path file = folder.resolve("window.properties");
        WindowState first = new WindowState(file);
        assertFalse(first.dark(), "sem arquivo, o padrão é o tema claro");

        first.rememberDark(true);
        first.save();

        assertTrue(new WindowState(file).dark());
    }

    @Test
    void aFileDescribingASmallWindowIsIgnored() throws Exception {
        Path file = folder.resolve("window.properties");
        Files.writeString(file, "x=0\ny=0\nwidth=100\nheight=100\n");

        assertNull(new WindowState(file).bounds());
    }
}
